// The filter groups people switch on and off. Each is one static ruleset plus its cosmetic and
// scriptlet data. The ids are also the declarativeNetRequest ruleset ids.

export type GroupId = "ads" | "privacy" | "malware" | "cookies" | "annoyances";

export interface Group {
  id: GroupId;
  label: string;
  detail: string;
  /** What gets counted when this group blocks something. */
  counts: "ads" | "trackers" | "threats" | "annoyances";
  defaultOn: boolean;
  lists: string[];
}

export const GROUPS: Group[] = [
  {
    id: "ads",
    label: "Ads",
    detail: "Adverts on websites and in videos, including YouTube. EasyList and uBlock filters.",
    counts: "ads",
    defaultOn: true,
    lists: ["easylist", "ubo-filters", "ubo-quickfixes", "ubo-unbreak"],
  },
  {
    id: "privacy",
    label: "Trackers",
    detail: "Analytics, tracking pixels and fingerprinting scripts, and tracking codes in links. EasyPrivacy.",
    counts: "trackers",
    defaultOn: true,
    lists: ["easyprivacy", "ubo-privacy"],
  },
  {
    id: "malware",
    label: "Scam and malware sites",
    detail: "Stops pages known for malware, scams and fake downloads before they load. URLhaus and uBlock badware.",
    counts: "threats",
    defaultOn: true,
    lists: ["ubo-badware", "urlhaus"],
  },
  {
    id: "cookies",
    label: "Cookie notices",
    detail: "Hides cookie consent banners and pop-ups. Sites then use their defaults, usually essential cookies only.",
    counts: "annoyances",
    defaultOn: true,
    lists: ["cookies"],
  },
  {
    id: "annoyances",
    label: "Annoyances",
    detail: "Newsletter pop-ups, \"get the app\" banners, chat bubbles and social widgets. Can hide things a few sites need.",
    counts: "annoyances",
    defaultOn: false,
    lists: ["annoyances"],
  },
];

export const GROUP_IDS = GROUPS.map((g) => g.id);
