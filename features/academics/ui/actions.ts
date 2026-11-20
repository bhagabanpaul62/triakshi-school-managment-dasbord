"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import {
  AcademicYearService, ClassService, ClassSubjectService, HouseService, SectionService, SectionTeacherService, SubjectGroupService, SubjectService, TermService, YearRolloverService,
} from "../service";

const id = (fd: FormData) => String(fd.get("id"));

export async function createYear(fd: FormData) { return serviceAction(AcademicYearService, (s) => s.create(formToObject(fd)), "Academic year added"); }
export async function updateYear(fd: FormData) { return serviceAction(AcademicYearService, (s) => s.update(id(fd), formToObject(fd)), "Academic year updated"); }
export async function deleteYear(fd: FormData) { return serviceAction(AcademicYearService, (s) => s.remove(id(fd)), "Academic year deleted"); }
export async function setCurrentYear(fd: FormData) { return serviceAction(AcademicYearService, (s) => s.setCurrent(id(fd)), "Current year changed"); }
export async function rollForward(fd: FormData) {
  const o = formToObject(fd);
  return serviceAction(YearRolloverService, (s) => s.rollForward(o.name as string | undefined, o.copyTeachers === "true" || o.copyTeachers === true), "Next year created");
}

export async function addDefaultTerms(fd: FormData) { return serviceAction(TermService, (s) => s.addDefaults(id(fd)), "Default terms added"); }
export async function createTerm(fd: FormData) { return serviceAction(TermService, (s) => s.create(formToObject(fd)), "Term added"); }
export async function updateTerm(fd: FormData) { return serviceAction(TermService, (s) => s.update(id(fd), formToObject(fd)), "Term updated"); }
export async function deleteTerm(fd: FormData) { return serviceAction(TermService, (s) => s.remove(id(fd)), "Term deleted"); }

export async function createClass(fd: FormData) { return serviceAction(ClassService, (s) => s.create(formToObject(fd)), "Class added"); }
export async function updateClass(fd: FormData) { return serviceAction(ClassService, (s) => s.update(id(fd), formToObject(fd)), "Class updated"); }
export async function deleteClass(fd: FormData) { return serviceAction(ClassService, (s) => s.remove(id(fd)), "Class deleted"); }
export async function addClassPresets() { return serviceAction(ClassService, (s) => s.addPresets(), "Preset classes added"); }

export async function createSection(fd: FormData) { return serviceAction(SectionService, (s) => s.create(formToObject(fd)), "Section added"); }
export async function updateSection(fd: FormData) { return serviceAction(SectionService, (s) => s.update(id(fd), formToObject(fd)), "Section updated"); }
export async function setClassTeacher(fd: FormData) { return serviceAction(SectionService, (s) => s.assignClassTeacher(formToObject(fd)), "Class teacher saved"); }
export async function deleteSection(fd: FormData) { return serviceAction(SectionService, (s) => s.remove(id(fd)), "Section deleted"); }

export async function createSubject(fd: FormData) { return serviceAction(SubjectService, (s) => s.create(formToObject(fd)), "Subject added"); }
export async function updateSubject(fd: FormData) { return serviceAction(SubjectService, (s) => s.update(id(fd), formToObject(fd)), "Subject updated"); }
export async function deleteSubject(fd: FormData) { return serviceAction(SubjectService, (s) => s.remove(id(fd)), "Subject deleted"); }
export async function addSubjectPreset(fd: FormData) { return serviceAction(SubjectService, (s) => s.addPreset(formToObject(fd)), "Subjects added"); }

export async function assignSubjects(fd: FormData) { return serviceAction(ClassSubjectService, (s) => s.assign(formToObject(fd)), "Subjects assigned"); }
export async function removeClassSubject(fd: FormData) { return serviceAction(ClassSubjectService, (s) => s.remove(id(fd)), "Subject removed from the class"); }

export async function assignTeacher(fd: FormData) { return serviceAction(SectionTeacherService, (s) => s.assign(formToObject(fd)), "Teacher saved"); }

export async function setElective(fd: FormData) { return serviceAction(ClassSubjectService, (s) => s.setElective(formToObject(fd)), "Subject updated"); }
export async function createGroup(fd: FormData) { return serviceAction(SubjectGroupService, (s) => s.create(formToObject(fd)), "Group added"); }
export async function updateGroup(fd: FormData) { return serviceAction(SubjectGroupService, (s) => s.update(id(fd), formToObject(fd)), "Group updated"); }
export async function deleteGroup(fd: FormData) { return serviceAction(SubjectGroupService, (s) => s.remove(id(fd)), "Group deleted"); }
export async function assignGroup(fd: FormData) { return serviceAction(SubjectGroupService, (s) => s.assign(formToObject(fd)), "Subjects saved"); }
export async function setElectiveChoices(fd: FormData) { return serviceAction(SubjectGroupService, (s) => s.setChoices(formToObject(fd)), "Electives saved"); }

export async function createHouse(fd: FormData) { return serviceAction(HouseService, (s) => s.create(formToObject(fd)), "House added"); }
export async function updateHouse(fd: FormData) { return serviceAction(HouseService, (s) => s.update(id(fd), formToObject(fd)), "House updated"); }
export async function deleteHouse(fd: FormData) { return serviceAction(HouseService, (s) => s.remove(id(fd)), "House deleted"); }
export async function updatePoints(fd: FormData) { return serviceAction(HouseService, (s) => s.updatePoints(id(fd), formToObject(fd)), "Points updated"); }
export async function deletePoints(fd: FormData) { return serviceAction(HouseService, (s) => s.removePoints(id(fd)), "Points entry deleted"); }
export async function assignHouse(fd: FormData) { return serviceAction(HouseService, (s) => s.assign(formToObject(fd)), "House saved"); }
export async function awardPoints(fd: FormData) { return serviceAction(HouseService, (s) => s.award(formToObject(fd)), "Points saved"); }
