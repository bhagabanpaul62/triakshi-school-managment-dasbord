import { AppError } from "@smw/feature-kit";

export class PaymentGatewayError extends AppError {
  constructor(message = "We could not reach the payment gateway. Please try again in a minute.") { super(message, "gateway", 502); }
}
