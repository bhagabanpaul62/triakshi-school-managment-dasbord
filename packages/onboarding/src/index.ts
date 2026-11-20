/**
 * School onboarding logic, shared by the marketing site (self-serve signup), the console (sales-assisted) and the school app.
 * @module @smw/onboarding
 */
export { SlugPolicy } from "./slug";
export { BOARDS, phoneSchema, signupSchema, type SignupData, type SignupInput } from "./schema";
export { PlanCatalog, type PublicPlan } from "./plans";
export { createSchool, slugTaken, type CreateSchoolInput, type CreatedSchool } from "./create-school";
export { OnboardingEmails, supportEmail } from "./emails";
export { emailOwner, signInLink, SET_PASSWORD_MINUTES, type EmailOwner } from "./sign-in-link";
export { SignupService, signupLimiter, slugCheckLimiter, resendLimiter, VERIFY_TOKEN_MINUTES, type SignupResult, type SlugCheck } from "./signup";
export { AppError, ConflictError, ValidationError } from "@smw/feature-kit";
