const SLOW_REQUEST_THRESHOLD_MS = 1_000;

export const requestTiming = (request, response, next) => {
  const startedAt = process.hrtime.bigint();

  response.once("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (elapsedMs >= SLOW_REQUEST_THRESHOLD_MS) {
      console.warn(
        `[slow-api] ${request.method} ${request.originalUrl} ` +
          `${response.statusCode} ${elapsedMs.toFixed(1)}ms ${request.id}`,
      );
    }
  });

  next();
};
