export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ProviderError extends AppError {
  constructor(message: string, status = 502, retryable = false) {
    super(message, status, retryable);
    this.name = "ProviderError";
  }
}
