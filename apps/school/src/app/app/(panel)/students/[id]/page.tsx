import StudentRecordPage, { metadata as recordMetadata } from "@smw/feature-students/ui/record-page";
import { StudentFeeCard } from "@smw/feature-fees/ui/student-fee-card";

export const metadata = recordMetadata;

/** The student record, with the fee card from the fees module put in its slot (students cannot import fees). */
export default async function Page(props: Parameters<typeof StudentRecordPage>[0]) {
  const { id } = await props.params;
  return <StudentRecordPage {...props} slots={{ fees: <StudentFeeCard studentId={id} /> }} />;
}
