"""Bottle API routes for Direct Select (央国企/大厂投递优选)."""

import json
from bottle import Bottle, request, response
from bosshunter.direct_select.manager import manager
from bosshunter.direct_select.models import ProfileSetting
from bosshunter.direct_select.db_store import (
    list_campaigns,
    get_campaign,
    delete_campaign,
    update_job_status,
    get_profile,
    save_profile
)


def _json_resp(data: any, status_code: int = 200):
    response.content_type = "application/json; charset=utf-8"
    response.status = status_code
    if hasattr(data, "model_dump"):
        return json.dumps(data.model_dump(), ensure_ascii=False)
    if isinstance(data, list):
        items = [x.model_dump() if hasattr(x, "model_dump") else x for x in data]
        return json.dumps(items, ensure_ascii=False)
    return json.dumps(data, ensure_ascii=False)


def register_direct_select_routes(app: Bottle):
    """向 Bottle app 注册所有直投优选 API."""

    @app.route("/api/direct-select/campaigns", method="GET")
    def api_get_campaigns():
        try:
            campaigns = list_campaigns()
            return _json_resp(campaigns)
        except Exception as e:
            return _json_resp({"error": str(e)}, 500)

    @app.route("/api/direct-select/campaigns", method="POST")
    def api_create_campaigns():
        try:
            payload = request.json or {}
            items = payload.get("items")
            if isinstance(items, list) and items:
                # 批量添加
                results = manager.batch_create_campaigns(items)
                return _json_resp(results, 201)
            else:
                # 单个添加
                cname = payload.get("company_name", "知名企业招聘")
                stype = payload.get("source_type", "text")
                sinput = payload.get("source_input", "")
                mtype = payload.get("media_type", "image/png")
                res = manager.create_and_enqueue_campaign(cname, stype, sinput, mtype)
                return _json_resp(res, 201)
        except Exception as e:
            return _json_resp({"error": str(e)}, 500)

    @app.route("/api/direct-select/campaigns/<campaign_id>", method="GET")
    def api_get_campaign(campaign_id: str):
        try:
            campaign = get_campaign(campaign_id)
            if not campaign:
                return _json_resp({"error": "Campaign not found"}, 404)
            return _json_resp(campaign)
        except Exception as e:
            return _json_resp({"error": str(e)}, 500)

    @app.route("/api/direct-select/campaigns/<campaign_id>", method="DELETE")
    def api_delete_campaign(campaign_id: str):
        try:
            delete_campaign(campaign_id)
            return _json_resp({"success": True})
        except Exception as e:
            return _json_resp({"error": str(e)}, 500)

    @app.route("/api/direct-select/campaigns/<campaign_id>/override", method="POST")
    def api_override_job(campaign_id: str):
        try:
            payload = request.json or {}
            job_id = payload.get("job_id")
            if not job_id:
                return _json_resp({"error": "job_id is required"}, 400)
            updated = manager.restore_excluded_job(campaign_id, job_id)
            if not updated:
                return _json_resp({"error": "Campaign or job not found"}, 404)
            return _json_resp(updated)
        except Exception as e:
            return _json_resp({"error": str(e)}, 500)

    @app.route("/api/direct-select/campaigns/<campaign_id>/re-evaluate", method="POST")
    def api_re_evaluate(campaign_id: str):
        try:
            updated = manager.re_evaluate_campaign(campaign_id)
            if not updated:
                return _json_resp({"error": "Campaign not found"}, 404)
            return _json_resp(updated)
        except Exception as e:
            return _json_resp({"error": str(e)}, 500)

    @app.route("/api/direct-select/campaigns/<campaign_id>/re-parse", method="POST")
    def api_re_parse(campaign_id: str):
        try:
            payload = request.json or {}
            supplemental = payload.get("supplemental_text", "")
            updated = manager.re_parse_campaign(campaign_id, supplemental)
            if not updated:
                return _json_resp({"error": "Campaign not found"}, 404)
            return _json_resp(updated)
        except Exception as e:
            return _json_resp({"error": str(e)}, 500)

    @app.route("/api/direct-select/jobs/<job_id>/status", method="POST")
    def api_update_job_status(job_id: str):
        try:
            payload = request.json or {}
            status = payload.get("status", "applied")
            update_job_status(job_id, status)
            return _json_resp({"success": True, "job_id": job_id, "status": status})
        except Exception as e:
            return _json_resp({"error": str(e)}, 500)

    @app.route("/api/direct-select/profile", method="GET")
    def api_get_profile():
        try:
            p = get_profile()
            return _json_resp(p)
        except Exception as e:
            return _json_resp({"error": str(e)}, 500)

    @app.route("/api/direct-select/profile", method="POST")
    def api_save_profile():
        try:
            payload = request.json or {}
            p = ProfileSetting(
                degree_level=int(payload.get("degree_level", 2)),
                degree_name=str(payload.get("degree_name", "本科")),
                major_name=str(payload.get("major_name", "计算机科学与技术")),
                grad_year=str(payload.get("grad_year", "2025届")),
                ignore_location=bool(payload.get("ignore_location", True)),
                resume_mode=str(payload.get("resume_mode", "default")),
                resume_text=str(payload.get("resume_text", ""))
            )
            save_profile(p)
            return _json_resp(p)
        except Exception as e:
            return _json_resp({"error": str(e)}, 500)
