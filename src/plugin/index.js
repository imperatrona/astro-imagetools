// @ts-check
import fs from "fs";
import path from "path";
import stream from "stream";
import { getConfigOptions, getImagePath } from "./utils/shared.js";
import {
  getLoadedImage,
  getTransformedImage,
  supportedFileTypes,
} from "./utils/sharpCheck.js";

let viteConfig;
const bundled = [];
const store = new Map();

export default {
  name: "vite-plugin-astro-imagetools",
  enforce: "pre",
  config: () => ({
    optimizeDeps: {
      exclude: ["@astropub/codecs", "imagetools-core", "sharp"],
    },
    ssr: {
      external: ["sharp", "potrace", "object-hash", "@astropub/codecs"],
    },
  }),

  configResolved(config) {
    viteConfig = config;
  },

  async load(id) {
    if (this.load) {
      // @ts-ignore
      import.meta.vitePluginContext = {
        load: this.load,
      };
    }

    try {
      var fileURL = new URL(`file://${id}`);
    } catch (error) {
      return null;
    }

    const { search, searchParams } = fileURL;

    const src = id.replace(search, "");

    const ext = path.extname(src).slice(1);

    if (supportedFileTypes.includes(ext)) {
      const base = path.basename(src, path.extname(src));

      const { base: projectBase } = viteConfig;

      const config = Object.fromEntries(searchParams);

      const { image: loadedImage, width: imageWidth } =
        store.get(src) ||
        store.set(src, await getLoadedImage(src, ext)).get(src);

      const { type, hash, widths, options, extension, inline } =
        getConfigOptions(config, ext, imageWidth);

      if (inline) {
        if (widths.length > 1) {
          throw new Error(
            `Cannot use base64 or raw or inline with multiple widths`
          );
        }

        const [width] = widths;

        const params = [base, projectBase, extension, width, hash];

        const { assetName } = getImagePath(...params);

        if (store.has(assetName)) {
          return `export default "${store.get(assetName)}"`;
        } else {
          const config = { width, ...options };

          const params = [src, loadedImage, config, type, true];

          const { dataUri } = await getTransformedImage(...params);

          store.set(assetName, dataUri);

          return `export default "${dataUri}"`;
        }
      } else {
        const sources = await Promise.all(
          widths.map(async (width) => {
            const params = [base, projectBase, extension, width, hash];

            const { name, path } = getImagePath(...params);

            if (!store.has(path)) {
              const config = { width, ...options };

              const params = [src, loadedImage, config, type];

              const { image, buffer } = await getTransformedImage(...params);

              const imageObject = { type, name, buffer, extension, image };

              store.set(path, imageObject);
            }

            return { width, path };
          })
        );

        const path =
          sources.length > 1
            ? sources.map(({ width, path }) => `${path} ${width}w`).join(", ")
            : sources[0].path;

        return `export default "${path}"`;
      }
    }
  },

  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const imageObject = store.get(request.url);

      if (imageObject) {
        const { type, buffer, image } = imageObject;

        response.setHeader("Content-Type", type);
        response.setHeader("Cache-Control", "no-cache");

        if (buffer) {
          return stream.Readable.from(buffer).pipe(response);
        }

        return image.clone().pipe(response);
      }

      next();
    });
  },

  async closeBundle() {
    if (viteConfig.mode === "production") {
      const assetNames = Object.keys(Object.fromEntries(store)).filter(
        (item) => item.startsWith("/assets/") && !bundled.includes(item)
      );

      const { outDir, assetsDir } = viteConfig.build;

      const assetsDirPath = `${outDir}${assetsDir}`;

      fs.existsSync(assetsDirPath) ||
        fs.mkdirSync(assetsDirPath, { recursive: true });

      const { assetFileNames = `/${assetsDir}/[name].[hash][extname]` } =
        viteConfig.build.rollupOptions.output;

      await Promise.all(
        assetNames.map(async (assetName) => {
          const { buffer, image } = store.get(assetName);

          const extname = path.extname(assetName);

          const base = path.basename(assetName, extname);

          const ext = extname.slice(1);

          const name = base.slice(0, base.lastIndexOf("."));

          const hash = base.slice(base.lastIndexOf(".") + 1);

          const assetFileName = assetFileNames
            .replace("[name]", name)
            .replace("[hash]", hash)
            .replace("[ext]", ext)
            .replace("[extname]", extname);

          await fs.promises.writeFile(
            outDir + assetFileName,
            buffer || (await image.clone().toBuffer())
          );

          bundled.push(assetName);
        })
      );
    }
  },
};
