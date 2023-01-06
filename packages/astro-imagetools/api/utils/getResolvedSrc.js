// @ts-check
import fs from "node:fs";
import { join, relative } from "node:path";
import throwErrorIfUnsupported from "./throwErrorIfUnsupported.js";
import {
  cwd,
  fsCachePath,
  supportedImageTypes,
} from "../../utils/runtimeChecks.js";

const { fileTypeFromBuffer } = await import("file-type");

const { createHmac } = await import('node:crypto')

export default async function getResolvedSrc(src) {
  const token = "ai_" + createHmac('sha256', src).digest('hex');

  let filepath = fsCachePath + token;

  const fileExists = (() => {
    for (const type of supportedImageTypes) {
      const fileExists = fs.existsSync(filepath + `.${type}`);

      if (fileExists) {
        filepath += `.${type}`;

        return true;
      }
    }
  })();

  if (!fileExists) {
    const buffer = Buffer.from(await (await fetch(src)).arrayBuffer());

    const { ext } = (await fileTypeFromBuffer(buffer)) || {};

    throwErrorIfUnsupported(src, ext);

    filepath += `.${ext}`;

    fs.writeFileSync(filepath, buffer);
  }

  src = join("/", relative(cwd, filepath));

  return src;
}
