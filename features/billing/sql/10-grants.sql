-- Platform-only table: the school app never reads or writes reminder markers.
REVOKE ALL ON billing_reminders FROM app_school;
