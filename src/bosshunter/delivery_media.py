"""Local, user-selected greeting images; independent of resume attachments."""
from io import BytesIO
from pathlib import Path
import re
from uuid import uuid4

MAX_IMAGE_BYTES = 10 * 1024 * 1024
IMAGE_ID = re.compile(r"[a-f0-9]{32}\.(?:png|jpg)\Z")


def resolve_greeting_image(data_dir: Path, image_id: str) -> Path:
    if not isinstance(image_id, str) or not IMAGE_ID.fullmatch(image_id):
        raise ValueError("招呼图片标识无效，请重新选择图片")
    path = data_dir / "greeting_images" / image_id
    if not path.is_file():
        raise ValueError("招呼图片不存在，请重新上传")
    return path.resolve()


def save_greeting_image(data_dir: Path, content: bytes) -> str:
    from PIL import Image, UnidentifiedImageError

    if not content or len(content) > MAX_IMAGE_BYTES:
        raise ValueError("请选择不超过 10MB 的 PNG 或 JPEG 图片")
    try:
        with Image.open(BytesIO(content)) as picture:
            extension = {"PNG": ".png", "JPEG": ".jpg"}.get(picture.format)
            if not extension or picture.width * picture.height > 40_000_000:
                raise ValueError("仅支持 PNG/JPEG 图片，且图片不能超过 4000 万像素")
            picture.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("图片无法读取，请选择有效的 PNG 或 JPEG 文件") from exc
    folder = data_dir / "greeting_images"
    folder.mkdir(parents=True, exist_ok=True)
    image_id = uuid4().hex + extension
    (folder / image_id).write_bytes(content)
    return image_id
