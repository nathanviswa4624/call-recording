import {
  Activity, AudioLines, BarChart3, Boxes, Cable, ClipboardList, Cpu, FileClock, FileDiff, Gauge, GitBranch, History, KeyRound, LayoutDashboard,
  ListTree, Network, PhoneIncoming, PhoneMissed, Radio, Route, ScrollText, Server, Settings, Shield, ShieldCheck, Split, SquareTerminal, Tags, TestTube2,
  Upload, Users, Waypoints, Archive, Building2, type LucideIcon,
} from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** User needs ANY of these permissions to see the item. */
  any?: string[];
  /** Not yet implemented in this release — rendered disabled with a "Planned" tag. */
  planned?: boolean;
}
export interface NavSection { label: string; items: NavItem[] }

export const NAV: NavSection[] = [
  { label: 'Dashboard', items: [{ label: 'Overview', href: '/', icon: LayoutDashboard, any: [P.REPORTS_VIEW, P.CALLS_VIEW] }] },
  {
    label: 'PBX',
    items: [
      { label: 'PBX Systems', href: '/pbx', icon: Building2, any: [P.TRUNKS_VIEW] },
      { label: 'SIP Trunks', href: '/trunks', icon: Cable, any: [P.TRUNKS_VIEW] },
      { label: 'PJSIP Endpoints', href: '/pjsip/endpoints', icon: Waypoints, any: [P.ENDPOINTS_VIEW] },
      { label: 'AORs', href: '/pjsip/aors', icon: Boxes, any: [P.ENDPOINTS_VIEW] },
      { label: 'Authentication', href: '/pjsip/auths', icon: KeyRound, any: [P.ENDPOINTS_VIEW] },
      { label: 'Identify Rules', href: '/pjsip/identifies', icon: ShieldCheck, any: [P.ENDPOINTS_VIEW] },
      { label: 'Transports', href: '/pjsip/transports', icon: Network, any: [P.ENDPOINTS_VIEW] },
      { label: 'Registrations', href: '/pjsip/registrations', icon: Radio, any: [P.ENDPOINTS_VIEW] },
    ],
  },
  {
    label: 'Routing',
    items: [
      { label: 'Routes & Groups', href: '/routing/routes', icon: Route, any: [P.ROUTES_VIEW] },
      { label: 'Route Patterns', href: '/routing/patterns', icon: Split, any: [P.ROUTES_VIEW] },
      { label: 'Dialplan', href: '/routing/dialplan', icon: ListTree, any: [P.DIALPLAN_CONFIGURE, P.ROUTES_VIEW] },
      { label: 'Route Tester', href: '/routing/tester', icon: TestTube2, any: [P.ROUTES_VIEW] },
      { label: 'Call Classification', href: '/routing/classification', icon: Tags, any: [P.ROUTES_VIEW] },
    ],
  },
  {
    label: 'Calls',
    items: [
      { label: 'Live Calls', href: '/calls/live', icon: Activity, any: [P.CALLS_VIEW] },
      { label: 'Call History', href: '/calls', icon: History, any: [P.CALLS_VIEW] },
      { label: 'Recordings', href: '/recordings', icon: AudioLines, any: [P.RECORDINGS_VIEW] },
      { label: 'Missed Calls', href: '/calls/missed', icon: PhoneMissed, any: [P.CALLS_VIEW] },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Call Report', href: '/reports/calls', icon: PhoneIncoming, any: [P.REPORTS_VIEW] },
      { label: 'Recording Report', href: '/reports/recordings', icon: AudioLines, any: [P.REPORTS_VIEW] },
      { label: 'Route Report', href: '/reports/routes', icon: GitBranch, any: [P.REPORTS_VIEW] },
      { label: 'Extension Report', href: '/reports/extensions', icon: Users, any: [P.REPORTS_VIEW] },
      { label: 'Trunk Report', href: '/reports/trunks', icon: Cable, any: [P.REPORTS_VIEW] },
      { label: 'Call Type Report', href: '/reports/call-types', icon: BarChart3, any: [P.REPORTS_VIEW] },
    ],
  },
  {
    label: 'Asterisk',
    items: [
      { label: 'System Status', href: '/asterisk/status', icon: Gauge, any: [P.SYSTEM_VIEW] },
      { label: 'SIP Status', href: '/asterisk/sip', icon: Server, any: [P.SYSTEM_VIEW] },
      { label: 'Asterisk CLI', href: '/asterisk/cli', icon: SquareTerminal, any: [P.CLI_ACCESS] },
      { label: 'Services', href: '/asterisk/status#services', icon: Cpu, any: [P.SYSTEM_VIEW] },
      { label: 'Logs', href: '#', icon: ScrollText, planned: true },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { label: 'Versions', href: '/config/versions', icon: FileClock, any: [P.CONFIG_VIEW] },
      { label: 'Compare Versions', href: '/config/compare', icon: FileDiff, any: [P.CONFIG_VIEW] },
      { label: 'Backups', href: '#', icon: Archive, planned: true },
      { label: 'Import Configuration', href: '#', icon: Upload, planned: true },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', href: '/admin/users', icon: Users, any: [P.USERS_MANAGE] },
      { label: 'Roles & Permissions', href: '/admin/roles', icon: Shield, any: [P.USERS_MANAGE] },
      { label: 'Audit Logs', href: '/admin/audit', icon: ClipboardList, any: [P.AUDIT_VIEW] },
      { label: 'System Settings', href: '#', icon: Settings, planned: true },
    ],
  },
];
