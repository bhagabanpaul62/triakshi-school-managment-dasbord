# @smw/integrations

Every outside service, behind an interface with a fake adapter for tests.

## What goes here

- `EmailSender`: Amazon SES Mumbai or similar
- `FileStorage`: S3-compatible bucket in India
- `PaymentGateway`: Razorpay
- `DnsResolver`: Node's DNS module, for custom domain checks

## When

Phase 2 onwards, one interface at a time.
