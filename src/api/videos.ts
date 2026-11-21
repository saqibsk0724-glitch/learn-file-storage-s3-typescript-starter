
import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import {
  BadRequestError,
  NotFoundError,
  UserForbiddenError,
} from "./errors";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  // 1. Get the video ID from the URL
  const { videoId } = req.params as { videoId?: string };

  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  // 2. Authenticate the user
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  // 3. Find the video in the database
  const video = getVideo(cfg.db, videoId);

  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  // 4. Check video ownership
  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized");
  }

  // 5. Read the uploaded video
  const formData = await req.formData();
  const file = formData.get("video");

  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  // 6. Check maximum file size (1 GB)
  const MAX_UPLOAD_SIZE = 1 << 30;

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video file too large");
  }

  // 7. Validate video MIME type
  if (file.type !== "video/mp4") {
    throw new BadRequestError("Invalid video file type");
  }

  // 8. Create a temporary file path
  const tempFilePath = join(tmpdir(), `${randomUUID()}.mp4`);

  try {
    // 9. Write the uploaded file to temporary storage
    await Bun.write(tempFilePath, file);

    // 10. Create the S3 object
    const key = `${videoId}.mp4`;

    const s3File = cfg.s3Client.file(key, {
      bucket: cfg.s3Bucket,
      region: cfg.s3Region,
      type: file.type,
    });

    // 11. Upload the temporary file to S3
    await s3File.write(Bun.file(tempFilePath));

    // 12. Generate the S3 URL
    video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;

    // 13. Update the database
    updateVideo(cfg.db, video);

    return respondWithJSON(200, video);
  } finally {
    // 14. Remove the temporary file
    await unlink(tempFilePath).catch(() => {});
  }
}
