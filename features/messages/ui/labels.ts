export const ROLE_LABELS: Record<string, string> = { admin: "Admin", accountant: "Accounts", teacher: "Teacher", parent: "Parent", student: "Student" };

/** "Riya Sharma (Teacher), Anil Kumar (Parent)" */
export const peopleLine = (people: { name: string; role: string }[]) => people.map((p) => `${p.name} (${ROLE_LABELS[p.role] ?? p.role})`).join(", ");
