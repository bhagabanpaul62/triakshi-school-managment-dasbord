// Lists and words with no server code behind them, so a screen can import them.
/** `students.left_reason` of a child who never started. Exactly this text: fees reads it. Import it from "@smw/feature-students/constants". */
export const WITHDREW_BEFORE_JOINING = "withdrew before joining";

/** "joining": accepted, not started. May be billed and may pay; in no register, audience or plan count; login off until `joinsOn`. */
export const STUDENT_STATUSES = ["joining", "active", "alumni", "left"] as const;
export const GENDERS = ["male", "female", "other"] as const;
export const GUARDIAN_RELATIONS = ["father", "mother", "guardian"] as const;

export const CONSENT_PURPOSES = [
  { value: "data_processing", label: "Data processing" },
  { value: "photo_on_website", label: "Photo on the school website" },
  { value: "photo_in_media", label: "Photo in print and social media" },
  { value: "trips_outings", label: "Trips and outings" },
  { value: "whatsapp_updates", label: "WhatsApp and SMS updates" },
] as const;
export const CONSENT_METHODS = ["paper_form", "in_person", "online"] as const;
export const DOCUMENT_KINDS = [
  { value: "birth_certificate", label: "Birth certificate" },
  { value: "transfer_certificate", label: "Transfer certificate" },
  { value: "report_card", label: "Previous report card" },
  { value: "address_proof", label: "Address proof" },
  { value: "other", label: "Other" },
] as const;
