import { useState } from "react";
import { LuMonitorPlay, LuPlus } from "react-icons/lu";

import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import { UnifiedSearchInput } from "@/components/search/UnifiedSearchInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Platform } from "@/shared/auth-types";
import { useMultiStreamStore } from "@/store/multistream-store";

export function AddStreamDialog() {
  const [open, setOpen] = useState(false);
  const [_channel, setChannel] = useState("");
  const [platform, setPlatform] = useState<Platform>("twitch");
  const [resetKey, setResetKey] = useState(0); // Key to reset the search input
  const addStream = useMultiStreamStore((state) => state.addStream);

  const handleSelectChannel = (selectedChannel: UnifiedChannel) => {
    // Automatically add when selected from dropdown
    addStream(selectedChannel.platform, selectedChannel.username);
    setChannel("");
    setResetKey((k) => k + 1);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="gap-2 bg-[var(--color-storm-primary)] hover:bg-[var(--color-storm-primary)]/90 text-black font-bold shadow-lg shadow-purple-900/20"
        >
          <LuPlus className="h-4 w-4" />
          Add Stream
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px] bg-[#0F0F12] border-[var(--color-border)] p-6 shadow-2xl">
        <DialogHeader className="pb-4 border-b border-[var(--color-border)]">
          <DialogTitle className="flex items-center gap-2 text-xl text-white">
            <LuMonitorPlay className="w-5 h-5 text-[var(--color-storm-primary)]" />
            Add Stream to Layout
          </DialogTitle>
          <DialogDescription className="text-[var(--color-foreground-muted)]">
            Choose a platform and search for a channel to add to your multistream grid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-6">
          <div className="grid gap-3">
            <label className="text-sm font-bold text-[var(--color-foreground)]">Platform</label>
            <Select value={platform} onValueChange={(val) => setPlatform(val as Platform)}>
              <SelectTrigger className="h-11 bg-[var(--color-background-secondary)] border-[var(--color-border)] text-white focus:ring-[var(--color-storm-primary)]">
                <SelectValue placeholder="Select platform" />
              </SelectTrigger>
              <SelectContent className="bg-[#1A1A1E] border-[var(--color-border)] text-white">
                <SelectItem
                  value="twitch"
                  className="focus:bg-zinc-800 focus:text-white cursor-pointer my-1"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-1 rounded bg-[#6441a5] text-white">
                      <TwitchIcon size={16} />
                    </div>
                    <span className="font-medium">Twitch</span>
                  </div>
                </SelectItem>
                <SelectItem
                  value="kick"
                  className="focus:bg-zinc-800 focus:text-white cursor-pointer my-1"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-1 rounded bg-[#53fc18] text-black">
                      <KickIcon size={16} />
                    </div>
                    <span className="font-medium">Kick</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3">
            <label
              htmlFor="channel-search"
              className="text-sm font-bold text-[var(--color-foreground)]"
            >
              Channel Search
            </label>
            <div
              className={cn(
                "rounded-xl p-1 transition-all duration-300",
                platform === "twitch"
                  ? "bg-gradient-to-r from-[#6441a5]/20 to-transparent"
                  : "bg-gradient-to-r from-[#53fc18]/10 to-transparent"
              )}
            >
              <UnifiedSearchInput
                key={resetKey}
                platform={platform}
                onSelectChannel={handleSelectChannel}
                onSearch={(term) => {
                  setChannel(term);
                  if (term.trim()) {
                    addStream(platform, term.trim());
                    setChannel("");
                    setResetKey((k) => k + 1);
                    setOpen(false);
                  }
                }}
                showCategories={false}
                liveOnlyChannels
                placeholder={`Search for ${platform === "twitch" ? "Twitch" : "Kick"} channels...`}
                inputClassName="h-12 rounded-lg border-[var(--color-border)] bg-[#0F0F12] px-4 text-base font-medium text-white focus:ring-2 focus:ring-[var(--color-storm-primary)] focus:border-transparent shadow-inner"
                className="w-full"
                autoFocus
              />
            </div>
            <p className="text-xs text-[var(--color-foreground-muted)] flex items-center gap-1.5 px-1">
              <span className="w-1 h-1 rounded-full bg-[var(--color-storm-primary)]" />
              Search live channels or enter an exact username
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
