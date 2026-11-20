"use server";

import { redirect } from "next/navigation";
import { formToObject, serviceAction } from "@smw/runtime";
import {
  ComponentService, DateSheetService, ExamService, GradeScaleService, MarksService, RemarkService, ReportSetupService, TermWeightService,
} from "../service";

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

const obj = (fd: FormData) => formToObject(fd) as Record<string, unknown>;
const bandsOf = (v: unknown) => { try { return JSON.parse(String(v)); } catch { return []; } };

export async function createScale(fd: FormData) {
  return serviceAction(GradeScaleService, (s) => s.create(formToObject(fd)), "Scale added");
}
export async function makeDefaultScale(fd: FormData) {
  return serviceAction(GradeScaleService, (s) => s.update(String(fd.get("id")), { name: String(fd.get("name")), isDefault: true }), "Default scale changed");
}
export async function deleteScale(fd: FormData) {
  return serviceAction(GradeScaleService, (s) => s.remove(String(fd.get("id"))), "Scale deleted");
}
export async function saveBands(fd: FormData) {
  return serviceAction(GradeScaleService, (s) => s.saveBands(String(fd.get("scaleId")), bandsOf(fd.get("bands"))), "Grades saved");
}
export async function saveCoScale(fd: FormData) {
  return serviceAction(ReportSetupService, (s) => s.saveCoScale(obj(fd)), "Co-scholastic scale saved");
}
export async function deleteCoScale(fd: FormData) {
  return serviceAction(ReportSetupService, (s) => s.removeCoScale(String(fd.get("id"))), "Scale deleted");
}
export async function saveTemplate(fd: FormData) {
  return serviceAction(ReportSetupService, (s) => s.saveTemplate(obj(fd)), "Report setup saved");
}
export async function applyPreset(fd: FormData) {
  return serviceAction(ReportSetupService, (s) => s.applyPreset(obj(fd)), "Preset applied");
}
export async function saveComponents(fd: FormData) {
  return serviceAction(ComponentService, (s) => s.save(obj(fd)), "Parts saved");
}
export async function saveWeights(fd: FormData) {
  return serviceAction(TermWeightService, (s) => s.save(obj(fd)), "Weights saved");
}
export async function saveRemarks(fd: FormData) {
  return serviceAction(RemarkService, (s) => s.save(obj(fd)), "Remarks saved");
}
export async function saveCoScholastic(fd: FormData) {
  return serviceAction(MarksService, (s) => s.saveCoScholastic(obj(fd)), "Grade saved");
}
export async function saveDateSheet(fd: FormData) {
  return serviceAction(DateSheetService, (s) => s.save(obj(fd)), "Date sheet saved");
}
