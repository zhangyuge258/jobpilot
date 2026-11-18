"""Workbench background task runner."""

from __future__ import annotations

from dataclasses import dataclass, field
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime
from threading import Event, RLock, Thread, Timer
from typing import Any, Callable
from uuid import uuid4

from bosshunter.throttle import SendWindowChecker


MODE_LABELS = {
    "full": "运行全流程",
    "collect": "单独采集",
    "company_search": "企业检索",
    "score": "单独 AI 评分",
    "rescore": "重新评分",
    "greet": "生成招呼语",
    "monitor": "单独监测",
    "deliver": "确认投递",
}

TERMINAL_STATUSES = {"completed", "failed", "stopped"}
ACTIVE_STATUSES = {"running", "stopping"}
DEADLINE_MODES = {"full", "monitor", "deliver"}


class TaskAlreadyRunningError(RuntimeError):
    """Raised when a mutually exclusive workbench task is already active."""


@dataclass
class WorkbenchTask:
    id: str
    mode: str
    label: str
    status: str = "running"
    logs: list[str] = field(default_factory=list)
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    deadline_at: str | None = None
    stop_reason: str | None = None
    stop_requested: Event = field(default_factory=Event, repr=False)
    metrics: dict[str, int] = field(default_factory=dict)
    progress: dict[str, Any] = field(default_factory=dict)
    context: dict[str, Any] = field(default_factory=dict, repr=False)

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "mode": self.mode,
            "label": self.label,
            "status": self.status,
            "logs": list(self.logs),
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "deadline_at": self.deadline_at,
            "stop_reason": self.stop_reason,
            "stop_requested": self.stop_requested.is_set(),
            "metrics": dict(self.metrics),
            "progress": dict(self.progress),
            "platforms": list(self.context.get("platforms", [])),
            "resources": sorted(self.context.get("resources", set())),
            "waiting_for": self.context.get("waiting_for", ""),
        }


Executor = Callable[[WorkbenchTask, dict], None]


def wait_for_initial_monitor_cooldown(
    task: WorkbenchTask,
    config: dict,
    log: Callable[[WorkbenchTask, str], None],
) -> bool:
    """Wait for the full-flow monitor cooldown; return true when cancellation wins."""
    raw_cooldown = config.get("monitor", {}).get("initial_cooldown_minutes", 10)
    try:
        cooldown_sec = max(float(raw_cooldown), 0) * 60
    except (TypeError, ValueError):
        cooldown_sec = 10 * 60
    if cooldown_sec <= 0:
        return False
    log(task, f"发送结束，首次监测将在 {cooldown_sec / 60:g} 分钟冷却后开始")
    if task.stop_requested.wait(cooldown_sec):
        log(task, "首次监测冷却已取消")
        return True
    return False


class WorkbenchTaskRunner:
    def __init__(self, executors: dict[str, Executor] | None = None):
        self._executors = executors or {}
        self._tasks: dict[str, WorkbenchTask] = {}
        self._threads: dict[str, Thread] = {}
        self._deadline_timers: dict[str, Timer] = {}
        self._lock = RLock()

    @staticmethod
    def _resources(mode: str, config: dict) -> set[str]:
        if mode == "company_search":
            return {"collect:boss", "collect:zhilian", "collect:51job"}
        if mode in {"collect", "full"}:
            platforms = config.get("_collection_options", {}).get("platform_order", ["boss"])
            return {f"collect:{p}" for p in platforms} | ({"full"} if mode == "full" else set())
        if mode in {"deliver", "monitor"}:
            return {"chat:boss"}
        if mode in {"score", "rescore"}:
            ids = config.get("_score_options", {}).get("job_ids")
            return {f"score:{job_id}" for job_id in ids} if ids else {"score:*"}
        return {"greet"}

    def _conflict_locked(self, resources: set[str], owner: WorkbenchTask | None = None):
        for task in self._tasks.values():
            if task is owner or task.status not in ACTIVE_STATUSES:
                continue
            held = task.context.get("resources", self._resources(task.mode, {}))
            if resources & held or (
                ("score:*" in resources and any(r.startswith("score:") for r in held))
                or ("score:*" in held and any(r.startswith("score:") for r in resources))
            ):
                return task
        return None

    def release_collection(self, task: WorkbenchTask) -> None:
        with self._lock:
            task.context["resources"] = {r for r in task.context.get("resources", set()) if not r.startswith("collect:")}

    @contextmanager
    def operation(self, task: WorkbenchTask, mode: str, config: dict):
        """Only shared operations wait; collection, tags and other jobs keep running."""
        resources = self._resources(mode, config)
        added: set[str] = set()
        acquired = False
        try:
            while not task.stop_requested.is_set():
                with self._lock:
                    conflict = self._conflict_locked(resources, task)
                    if not conflict:
                        held = task.context.setdefault("resources", set())
                        added = resources - held
                        held.update(added)
                        task.context.pop("waiting_for", None)
                        acquired = True
                        break
                    task.context["waiting_for"] = f"等待{conflict.label}释放当前操作"
                task.stop_requested.wait(0.1)
            yield acquired
        finally:
            with self._lock:
                task.context.setdefault("resources", set()).difference_update(added)
                task.context.pop("waiting_for", None)

    def start(
        self,
        mode: str,
        config: dict,
        *,
        before_start: Callable[[], None] | None = None,
    ) -> dict:
        if mode not in MODE_LABELS:
            raise ValueError(f"Unsupported workbench mode: {mode}")

        with self._lock:
            resources = self._resources(mode, config)
            active = self._conflict_locked(resources)
            if active:
                raise TaskAlreadyRunningError(
                    f"相同平台或岗位的操作「{active.label}」正在运行或停止中，请等待其结束"
                )

            # One worker and stop token per platform. Admission and saving the
            # dialog preferences stay atomic, including multi-platform starts.
            options = config.get("_collection_options", {})
            platforms = options.get("platform_order", ["boss"])
            if mode == "collect" and len(platforms) > 1:
                if before_start is not None:
                    before_start()
                snapshots = []
                for platform in platforms:
                    child_config = {**config, "_collection_options": deepcopy(options)}
                    child_config["_collection_options"].update({
                        "platform_order": [platform],
                        "platforms": {platform: options["platforms"][platform]},
                    })
                    snapshots.append(self.start(mode, child_config))
                return {**snapshots[0], "tasks": snapshots}

            task = WorkbenchTask(id=str(uuid4()), mode=mode, label=MODE_LABELS[mode])
            task.context["resources"] = resources
            task.context["platforms"] = list(platforms) if mode in {"collect", "full"} else list(config.get(
                "_workbench_platforms", ["boss"] if mode in {"deliver", "monitor", "greet"} else []
            ))
            task.context["job_ids"] = list(config.get("_workbench_job_ids", []))
            deadline = _deadline_from_config(mode, config)
            if deadline:
                task.deadline_at = deadline.isoformat(timespec="seconds")
            if deadline and deadline <= datetime.now():
                task.stop_requested.set()
                task.status = "stopped"
                task.stop_reason = "今日发送时间窗口已截止，后台未启动"
                task.logs.append(task.stop_reason)
                task.updated_at = datetime.now().isoformat(timespec="seconds")
                self._tasks[task.id] = task
                return task.snapshot()

            # Persist start settings under the same lock as admission. A failed
            # callback must leave no registered task or worker behind.
            if before_start is not None:
                before_start()
            self._tasks[task.id] = task
            thread = Thread(target=self._run, args=(task, config), daemon=True)
            self._threads[task.id] = thread
            if deadline:
                delay_seconds = max((deadline - datetime.now()).total_seconds(), 0)
                timer = Timer(delay_seconds, self._stop_at_deadline, args=(task.id,))
                timer.daemon = True
                self._deadline_timers[task.id] = timer
                timer.start()
            thread.start()
            return task.snapshot()

    def status(self) -> dict:
        with self._lock:
            active = self._active_task_locked()
            tasks = [task.snapshot() for task in self._tasks.values()]
            return {
                "active": active.snapshot() if active else None,
                "active_tasks": [task for task in tasks if task["status"] in ACTIVE_STATUSES],
                "last_task": tasks[-1] if tasks else None,
                "tasks": tasks,
            }

    def stop(self, task_id: str, reason: str = "用户已请求停止") -> dict:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                raise KeyError(task_id)
            if task.status in TERMINAL_STATUSES:
                return task.snapshot()
            task.stop_requested.set()
            task.status = "stopping"
            task.stop_reason = reason
            if reason and (not task.logs or task.logs[-1] != reason):
                task.logs.append(reason)
            task.updated_at = datetime.now().isoformat(timespec="seconds")
            confirmation_event = task.context.get("confirmation_event")
            if isinstance(confirmation_event, Event):
                confirmation_event.set()
            monitor_wakeup_event = task.context.get("monitor_wakeup_event")
            if isinstance(monitor_wakeup_event, Event):
                monitor_wakeup_event.set()
            return task.snapshot()

    def wait(self, timeout: float | None = None) -> None:
        threads = list(self._threads.values())
        for thread in threads:
            thread.join(timeout=timeout)

    def _run(self, task: WorkbenchTask, config: dict) -> None:
        try:
            config = dict(config)
            config["_workbench_score_operation"] = lambda ids: self.operation(
                task, "score", {"_score_options": {"job_ids": ids}}
            )
            config["_workbench_collection_finished"] = lambda: self.release_collection(task)
            executor = self._executors.get(task.mode)
            if executor:
                executor(task, config)
            with self._lock:
                if task.stop_requested.is_set():
                    task.status = "stopped"
                else:
                    task.status = "completed"
                task.updated_at = datetime.now().isoformat(timespec="seconds")
        except Exception as exc:
            with self._lock:
                if task.stop_requested.is_set():
                    task.status = "stopped"
                    task.error = None
                else:
                    task.status = "failed"
                    task.error = str(exc)
                task.updated_at = datetime.now().isoformat(timespec="seconds")
        finally:
            with self._lock:
                timer = self._deadline_timers.pop(task.id, None)
            if timer:
                timer.cancel()

    def _stop_at_deadline(self, task_id: str) -> None:
        try:
            self.stop(task_id, "已到发送时间窗口截止时间，后台自动停止")
        except KeyError:
            return

    def _active_task_locked(self) -> WorkbenchTask | None:
        for task in self._tasks.values():
            if task.status in ACTIVE_STATUSES:
                return task
        return None


def _deadline_from_config(mode: str, config: dict) -> datetime | None:
    """Resolve the automatic stop deadline for long-running/send tasks."""
    if mode not in DEADLINE_MODES:
        return None
    throttle = config.get("throttle", {}) if isinstance(config, dict) else {}
    windows = throttle.get("send_windows", ["09:00-16:00"])
    return SendWindowChecker(windows).latest_end_datetime()
