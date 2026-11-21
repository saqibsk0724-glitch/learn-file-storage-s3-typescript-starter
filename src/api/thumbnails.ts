
import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import {join} from "path";
import { randomBytes } from "crypto";
import {
  BadRequestError,
  NotFoundError,
  UserForbiddenError,
} from "./errors";


export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };

  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  // Authenticate the user
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  // Parse multipart form data
  const formData = await req.formData();

  // Get the uploaded file
  const file = formData.get("thumbnail");

  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  // Check maximum file size (10 MB)
  const MAX_UPLOAD_SIZE = 10 << 20;

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file too large");
  }

  // Allow only JPEG and PNG images
if (file.type !== "image/jpeg" && file.type !== "image/png") {
  throw new BadRequestError("Invalid thumbnail file type");
}

  // Get the file extension from its media type
  const fileExtension = file.type.split("/")[1];

  if (!fileExtension) {
    throw new BadRequestError("Invalid thumbnail file type");
  }

  // Get video metadata
  const video = getVideo(cfg.db, videoId);

  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  // Check video ownership
  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized");
  }

  // Create the file path
 const randomName = randomBytes(32).toString("base64url");
 const fileName = `${randomName}.${fileExtension}`;
 const filePath = join(cfg.assetsRoot, fileName);

  // Read and save the image to disk
  const data = await file.arrayBuffer();
  await Bun.write(filePath, data);

  // Generate the thumbnail URL
  const thumbnailURL = `http://localhost:${cfg.port}/assets/${fileName}`;

  // Update video metadata
  video.thumbnailURL = thumbnailURL;

  // Save updated metadata in SQLite
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
