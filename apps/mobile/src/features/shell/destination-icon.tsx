import {
  Bell,
  Heart,
  Menu,
  Play,
  Search,
  type LucideIcon,
} from "lucide-react-native";

import { mobileSizing } from "@mobile/design/tokens";

import type { ShellDestinationId } from "./shell-navigation";

const destinationIcons: Readonly<Record<ShellDestinationId, LucideIcon>> = {
  search: Search,
  following: Heart,
  watch: Play,
  activity: Bell,
  more: Menu,
};

export function DestinationIcon({
  color,
  destination,
}: {
  readonly color: string;
  readonly destination: ShellDestinationId;
}) {
  const Icon = destinationIcons[destination];
  return (
    <Icon
      accessibilityElementsHidden
      color={color}
      size={mobileSizing.icon}
      strokeWidth={2}
    />
  );
}
