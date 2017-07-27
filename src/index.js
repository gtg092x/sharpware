import { isString, defaultsDeep, compact, noop } from 'lodash';
import sharp from 'sharp';
import QS from 'qs';
import URL from 'url';
import stream from 'stream';

const defaultGetImage = (req) => {
  return Buffer.from(req.body, 'base64');
};

const doGetImage = ({ getImage = defaultGetImage }) => (req) => {
  return Promise.resolve(getImage(req));
};

const defaultParamSource = (req) => {
  const { originalUrl } = req;
  const url = URL.parse(originalUrl);
  const { query = '' } = url;
  return QS.parse(query, { ignoreQueryPrefix: true }) || {};
};

const doGetParams = ({ getParams = defaultParamSource, defaults = {} }) => (req) => {
  return Promise.resolve(getParams(req)).then(params => defaultsDeep(params, defaults));
};

function numberOrObject(val) {
  const result = isString(val) ? Number(val) : val;
  if (isNaN(result)) {
    throw new Error(`${val} is not a number`);
  }
  return result;
}

function enforceTypes(methodName, args) {
  switch (methodName) {
    case 'blur':
    case 'rotate':
    {
      return numberOrObject(args);
    }
    case 'sharpen':
    case 'resize':
    {
      if (Array.isArray(args)) {
        return args.map(numberOrObject);
      }
      return args;
    }
    default:
      return args;
  }
}

const log = console.log;

function isReadableStream(obj) {
  return obj instanceof stream.Stream &&
    typeof obj._read === 'function' &&
    typeof obj._readableState === 'object';
}

export default function sharpWare(config = {}) {
  const { middleware = false, info: infoConfig = noop } = config;

  const info = ({ length, format }, req, res) => {
    const head = {
      'Content-Type': `image/${format}`,
    };
    if (length) {
      head['Content-Length'] = length;
    }
    if (!middleware) {
      return res.writeHead(200, head);
    }
    return infoConfig(200, head);
  };
  const done = (result, req, res, next) => {
    if (middleware) {
      req.locals.sharp = result;
      return next();
    }
    res.end(result);
  };
  const outStream = (req, res, next) => {
    if (middleware) {
      // TODO
      return res;
    }
    return res;
  };
  const error = (err, req, res, next) => {
    if (middleware) {
      return next(err);
    }
    return res.json({
      ...err,
      message: err.message || 'error',
      stack: err.stack,
    })
  };

  return (req, res, next) => {
    Promise.all([
      doGetParams(config)(req),
      doGetImage(config)(req),
    ]).then(([parsedQuery, imageSrc]) => {
      const {
        options,
        meta,
        format = 'png',
        formatOptions = {},
        src,
        ...query
      } = parsedQuery;

      const isStream = isReadableStream(imageSrc);
      const args = compact(isStream ? [options] : [imageSrc, options]);

      let image = sharp(...args);
      image = Object.keys(query).reduce((memo, method) => {
        const args = [];
        const methodVal = enforceTypes(method, query[method]);
        if (Array.isArray(methodVal)) {
          args.push(...methodVal);
        } else {
          args.push(methodVal);
        }
        if (memo[method]) {
          if (config.logging) {
            log(method, args);
          }
          return memo[method](...args);
        }
        if (config.logging) {
          log('SKIPPING', method, args);
        }
        return memo;
      }, image);
      if (meta) {
        image = image.withMetadata(meta);
      }
      if (format) {
        image = image[format](formatOptions);
      }

      if (isStream) {
        info({ format }, req, res);
        const { passThrough = new stream.PassThrough() } = config;
        return imageSrc
          .pipe(image)
          .pipe(passThrough)
          .pipe(outStream(req, res, next));
      }

      return image.toBuffer().then((buf) => {
        const { complete = noop } = config;
        Promise.resolve(complete(buf)).then(() => {
          info({ format, length: buf.length }, req, res);
          done(buf, req, res, next);
        });
      });
    }).catch(err => error(err, req, res, next));

  };
}