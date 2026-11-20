"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { RouteNoticeService } from "../notices";
import { RouteService, StudentTransportService, VehicleService } from "../service";
import type { UploadedFile } from "../files";
import { VehicleCareService } from "../vehicle-care";

/** The file of a form field as a plain value: `File` never reaches a service. */
async function uploadFrom(fd: FormData, field: string): Promise<UploadedFile | undefined> {
  const v = fd.get(field);
  return v instanceof File && v.size > 0 ? { name: v.name, type: v.type, size: v.size, bytes: new Uint8Array(await v.arrayBuffer()) } : undefined;
}

export async function createVehicle(fd: FormData) {
  return serviceAction(VehicleService, (s) => s.create(formToObject(fd)), "Vehicle added");
}
export async function updateVehicle(fd: FormData) {
  return serviceAction(VehicleService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Vehicle updated");
}
export async function deleteVehicle(fd: FormData) {
  return serviceAction(VehicleService, (s) => s.remove(String(fd.get("id"))), "Vehicle deleted");
}

export async function createRoute(fd: FormData) {
  return serviceAction(RouteService, (s) => s.create(formToObject(fd)), "Route added");
}
export async function updateRoute(fd: FormData) {
  return serviceAction(RouteService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Route updated");
}
export async function deleteRoute(fd: FormData) {
  return serviceAction(RouteService, (s) => s.remove(String(fd.get("id"))), "Route deleted");
}

export async function addStop(fd: FormData) {
  return serviceAction(RouteService, (s) => s.addStop(String(fd.get("routeId")), formToObject(fd)), "Stop added");
}
export async function updateStop(fd: FormData) {
  return serviceAction(RouteService, (s) => s.updateStop(String(fd.get("id")), formToObject(fd)), "Stop updated");
}
export async function removeStop(fd: FormData) {
  return serviceAction(RouteService, (s) => s.removeStop(String(fd.get("id"))), "Stop removed");
}

export async function assignStudent(fd: FormData) {
  return serviceAction(StudentTransportService, (s) => s.assign(formToObject(fd)), "Student added to the route");
}
export async function unassignStudent(fd: FormData) {
  return serviceAction(StudentTransportService, (s) => s.unassign(String(fd.get("studentId"))), "Student removed from transport");
}

export async function addDocument(fd: FormData) {
  return serviceAction(VehicleCareService, async (s) => s.addDocument(formToObject(fd), await uploadFrom(fd, "file")), "Paper added");
}
export async function updateDocument(fd: FormData) {
  return serviceAction(VehicleCareService, async (s) => s.updateDocument(String(fd.get("id")), formToObject(fd), await uploadFrom(fd, "file")), "Paper updated");
}
export async function removeDocument(fd: FormData) {
  return serviceAction(VehicleCareService, (s) => s.removeDocument(String(fd.get("id"))), "Paper removed");
}

export async function toggleChecklistItem(fd: FormData) {
  return serviceAction(VehicleCareService, (s) => s.toggleItem(formToObject(fd)), "Checklist updated");
}
export async function addChecklistItem(fd: FormData) {
  return serviceAction(VehicleCareService, (s) => s.addItem(formToObject(fd)), "Item added");
}
export async function removeChecklistItem(fd: FormData) {
  return serviceAction(VehicleCareService, (s) => s.removeItem(formToObject(fd)), "Item removed");
}

export async function sendRouteNotice(fd: FormData) {
  return serviceAction(RouteNoticeService, (s) => s.send(formToObject(fd)), "Notice sent to the route's students");
}
