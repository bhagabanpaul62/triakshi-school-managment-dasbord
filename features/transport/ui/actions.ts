"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { RouteService, StudentTransportService, VehicleService } from "../service";

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
