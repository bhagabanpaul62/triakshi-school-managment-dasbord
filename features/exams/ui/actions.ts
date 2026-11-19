"use server";

import { redirect } from "next/navigation";
import { formToObject, serviceAction } from "@smw/runtime";
import { ExamService, MarksService } from "../service";

export async function createExam(fd: FormData) {
  const r = await serviceAction(ExamService, (s) => s.createWithPapers(formToObject(fd)), "Exam created with its papers");
  // Land on the new exam so the next step (schedule it) is in front of the admin.
  if (r.ok) redirect(`/app/exams/${(r.data as { exam: { id: string } }).exam.id}`);
  return r;
}
export async function updateExam(fd: FormData) {
  return serviceAction(ExamService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Exam updated");
}
export async function deleteExam(fd: FormData) {
  return serviceAction(ExamService, (s) => s.remove(String(fd.get("id"))), "Exam deleted");
}
export async function addPapers(fd: FormData) {
  return serviceAction(ExamService, (s) => s.addPapers(String(fd.get("examId")), formToObject(fd)), "Papers added");
}
export async function removePaper(fd: FormData) {
  return serviceAction(ExamService, (s) => s.removePaper(formToObject(fd)), "Paper removed");
}
export async function transitionExam(fd: FormData) {
  return serviceAction(ExamService, (s) => s.transition(formToObject(fd)), "Exam updated");
}
export async function saveMarks(fd: FormData) {
  return serviceAction(MarksService, (s) => s.save(formToObject(fd)), "Marks saved");
}
