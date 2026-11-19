"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { AnnouncementService } from "../service";

export async function createAnnouncement(fd: FormData) {
  return serviceAction(AnnouncementService, (s) => s.create(formToObject(fd)), "Announcement posted");
}
export async function updateAnnouncement(fd: FormData) {
  return serviceAction(AnnouncementService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Announcement updated");
}
export async function deleteAnnouncement(fd: FormData) {
  return serviceAction(AnnouncementService, (s) => s.remove(String(fd.get("id"))), "Announcement deleted");
}
