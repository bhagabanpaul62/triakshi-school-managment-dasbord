// The services of the students feature. One class per aggregate, all sharing the access rules in access.ts.
export { StudentService, type Student, type StudentCapacity, type StudentListRow } from "./student-service";
export { GuardianService } from "./guardian-service";
export { ConsentService, DocumentService, PhotoService } from "./record-services";
export { ImportService, IMPORT_COLUMNS, type ImportReport, type ImportRowReport } from "./import-service";
export { PromotionService } from "./promotion-service";
export { StudentAccess } from "./access";
