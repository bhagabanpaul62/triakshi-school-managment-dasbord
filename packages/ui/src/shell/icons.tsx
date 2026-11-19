import {
  IconAddressBook, IconBell, IconBook, IconBooks, IconBuildingBank, IconBus, IconCalendarEvent, IconCalendarWeek, IconChalkboard,
  IconChartBar, IconChecklist, IconClipboardList, IconClockHour4, IconCreditCard, IconFileCertificate, IconFileText, IconHome,
  IconId, IconInbox, IconLifebuoy, IconMessages, IconPalette, IconReceipt2, IconReportAnalytics, IconSchool, IconSettings,
  IconShieldLock, IconSpeakerphone, IconUpload, IconUser, IconUserHeart, IconUsers, IconWorld, IconWorldWww, IconBadge,
  type Icon,
} from "@tabler/icons-react";

/** Menu icon names (declared in feature.ts as plain strings) → Tabler icons. */
export const MENU_ICONS: Record<string, Icon> = {
  home: IconHome, users: IconUsers, user: IconUser, teacher: IconChalkboard, parent: IconUserHeart, class: IconSchool,
  subject: IconBook, calendar: IconCalendarWeek, clock: IconClockHour4, check: IconChecklist, money: IconBuildingBank,
  receipt: IconReceipt2, exam: IconClipboardList, result: IconFileCertificate, book: IconBook, assignment: IconFileText,
  megaphone: IconSpeakerphone, event: IconCalendarEvent, message: IconMessages, settings: IconSettings, billing: IconCreditCard,
  web: IconWorldWww, palette: IconPalette, globe: IconWorld, bus: IconBus, library: IconBooks, bell: IconBell, inbox: IconInbox,
  chart: IconChartBar, shield: IconShieldLock, upload: IconUpload, support: IconLifebuoy, report: IconReportAnalytics,
  domain: IconWorld, id: IconId, badge: IconBadge, contacts: IconAddressBook,
};

export function MenuIconView({ name, className }: { name: string; className?: string }) {
  const I = MENU_ICONS[name] ?? IconHome;
  return <I className={className ?? "h-[18px] w-[18px]"} strokeWidth={1.7} aria-hidden />;
}
