import type { Field } from "@smw/ui/shell/FormModal";
import { paise } from "@smw/ui/format";
import { clock12 } from "../rules";

export const vehicleFields: Field[] = [
  { name: "registrationNo", label: "Registration number", required: true, placeholder: "KA 01 AB 1234" },
  { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "bus", label: "Bus" }, { value: "van", label: "Van" }] },
  { name: "capacity", label: "Seats for students", type: "number", required: true, min: 1, max: 120 },
  { name: "driverName", label: "Driver", required: true },
  { name: "driverPhone", label: "Driver's mobile", type: "tel", required: true },
  { name: "attendantName", label: "Attendant" },
  { name: "gpsDeviceId", label: "GPS device ID", hint: "Leave empty if the vehicle has no tracker" },
  { name: "trackingUrl", label: "Live tracking link", type: "text", wide: true, placeholder: "https://", hint: "The page your GPS vendor gives parents. Students see it under My transport. Must start with https://" },
];

export const documentFields = (kinds: { value: string; label: string }[]): Field[] => [
  { name: "kind", label: "Paper", type: "select", required: true, options: kinds },
  { name: "number", label: "Number" },
  { name: "expiresOn", label: "Expires on", type: "date", required: true },
  { name: "file", label: "Copy", type: "file", accept: "application/pdf,image/png,image/jpeg,image/webp", hint: "PDF or photo, up to 15 MB. Optional" },
];

export const checklistItemFields: Field[] = [{ name: "label", label: "Item", required: true, placeholder: "Panic button" }];

export const noticeFields: Field[] = [
  { name: "title", label: "Title", required: true, wide: true, placeholder: "Bus is running late" },
  { name: "body", label: "Message", type: "textarea", required: true, wide: true, placeholder: "The bus will reach stops about 20 minutes late today." },
];

export const routeFields = (vehicles: { id: string; registrationNo: string; kind: string; capacity: number }[]): Field[] => [
  { name: "name", label: "Route name", required: true, wide: true, placeholder: "Koramangala - Indiranagar" },
  { name: "vehicleId", label: "Vehicle", type: "select", wide: true, options: vehicles.map((v) => ({ value: v.id, label: `${v.registrationNo} (${v.kind}, ${v.capacity} seats)` })) },
  { name: "morningStart", label: "Morning pickup starts", type: "time", required: true },
  { name: "eveningStart", label: "Evening drop starts", type: "time", required: true },
];

export const stopFields = (withPosition: boolean): Field[] => [
  { name: "name", label: "Stop", required: true, wide: true, placeholder: "Forum Mall gate" },
  { name: "morningTime", label: "Morning time", type: "time", required: true },
  { name: "eveningTime", label: "Evening time", type: "time", required: true },
  { name: "monthlyFeePaise", label: "Monthly fee (both ways)", type: "money", required: true },
  ...(withPosition ? [{ name: "position", label: "Place on route", type: "number", min: 1, hint: "Leave empty to add at the end" } satisfies Field] : []),
];

export const assignFields = (students: { id: string; name: string; admissionNo: string; className: string | null; sectionName: string | null }[], stops: { id: string; name: string; morningTime: string; eveningTime: string; monthlyFeePaise: number }[]): Field[] => [
  { name: "studentId", label: "Student", type: "select", required: true, wide: true,
    options: students.map((s) => ({ value: s.id, label: `${s.name} (${s.className ? `${s.className}${s.sectionName ? `-${s.sectionName}` : ""}, ` : ""}${s.admissionNo})` })) },
  { name: "stopId", label: "Boarding stop", type: "select", required: true, wide: true, options: stops.map((s) => ({ value: s.id, label: `${s.name} (${clock12(s.morningTime)} / ${clock12(s.eveningTime)}, ${paise(s.monthlyFeePaise)} a month)` })) },
  { name: "pickup", label: "Morning", type: "checkbox", placeholder: "Pickup from the stop" },
  { name: "drop", label: "Evening", type: "checkbox", placeholder: "Drop at the stop", hint: "One way costs half the monthly fee" },
  { name: "startsOn", label: "Starts on", type: "date", hint: "Leave empty to start today" },
];
