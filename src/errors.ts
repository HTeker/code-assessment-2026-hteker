export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = (message = "Missing or unknown user") =>
  new AppError("UNAUTHORIZED", 401, message);
export const forbidden = (message: string) => new AppError("FORBIDDEN", 403, message);
export const notFound = (what: string) => new AppError("NOT_FOUND", 404, `${what} not found`);
export const badRequest = (code: string, message: string) => new AppError(code, 400, message);
export const conflict = (code: string, message: string) => new AppError(code, 409, message);
