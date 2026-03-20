import { useState } from "react";
import { IoMdSettings } from "react-icons/io";
import {
  LuCircleAlert,
  LuCircleHelp,
  LuDownload,
  LuLink,
  LuMonitor,
  LuRefreshCw,
  LuRocket,
  LuShieldCheck,
  LuTriangleAlert,
} from "react-icons/lu";

import { AccountConnect } from "@/components/auth";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAppVersion, useAppVersionInfo, useUpdater } from "@/hooks";
import { useAuthError } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { DEFAULT_PLAYBACK_PREFERENCES, type VideoQuality } from "@/shared/auth-types";
import { useAdBlockStore } from "@/store/adblock-store";
import { useAuthStore } from "@/store/auth-store";

export function SettingsPage() {
  const appVersion = useAppVersion();
  const versionInfo = useAppVersionInfo();
  const [activeTab, setActiveTab] = useState("playback");

  // Get auth state
  const { error, clearError } = useAuthError();
  const preferences = useAuthStore((state) => state.preferences);
  const updatePreferences = useAuthStore((state) => state.updatePreferences);

  // Ad-block state
  const enableAdBlock = useAdBlockStore((state) => state.enableAdBlock);
  const setEnableAdBlock = useAdBlockStore((state) => state.setEnableAdBlock);

  // Updater state
  const {
    status,
    updateInfo,
    progress,
    error: updateError,
    allowPrerelease,
    isChecking,
    isDownloading,
    isUpdateAvailable,
    isUpdateDownloaded,
    hasError,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    setAllowPrerelease,
  } = useUpdater();

  const [saved, setSaved] = useState(false);

  const handleQualityChange = async (value: string) => {
    // Cast string to VideoQuality since we know the values are valid
    const quality = value as VideoQuality;

    // Update store
    await updatePreferences({
      playback: {
        ...(preferences?.playback || DEFAULT_PLAYBACK_PREFERENCES),
        defaultQuality: quality,
      },
    });

    // Show saved indicator
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex h-full bg-[#09090b] text-zinc-100 overflow-hidden">
      {/* Sidebar Navigation */}
      <div className="w-[280px] flex-shrink-0 flex flex-col border-r border-[#27272a] bg-[#121214]">
        <div className="p-6 pb-2">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <IoMdSettings className="w-6 h-6 text-zinc-400" />
            Settings
          </h1>
          <p className="text-zinc-500 text-xs font-medium mt-1 uppercase tracking-wide opacity-80">
            App Settings & Project Settings
          </p>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-6">
          {/* Section: APP SETTINGS */}
          <div className="space-y-1">
            <h3 className="px-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 mt-4">
              App Settings
            </h3>

            <SidebarItem
              icon={LuMonitor}
              label="Playback"
              description="Stream quality & preferences"
              isActive={activeTab === "playback"}
              onClick={() => setActiveTab("playback")}
            />
            <SidebarItem
              icon={LuShieldCheck}
              label="Ad-Block"
              description="Twitch ad-blocking settings"
              isActive={activeTab === "adblock"}
              onClick={() => setActiveTab("adblock")}
            />
            <SidebarItem
              icon={LuLink}
              label="Integrations"
              description="Connected accounts & APIs"
              isActive={activeTab === "integrations"}
              onClick={() => setActiveTab("integrations")}
            />
            <SidebarItem
              icon={LuRefreshCw}
              label="Updates"
              description="Auto update preferences"
              isActive={activeTab === "updates"}
              onClick={() => setActiveTab("updates")}
            />
            <SidebarItem
              icon={LuCircleHelp}
              label="About"
              description="Version & info"
              isActive={activeTab === "about"}
              onClick={() => setActiveTab("about")}
            />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto bg-[#09090b]">
        <div className="max-w-4xl p-8 py-10">
          {/* Playback Tab */}
          {activeTab === "playback" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h2 className="text-2xl font-bold mb-1">Playback</h2>
                <p className="text-zinc-400">Manage your default stream viewing experience.</p>
              </div>

              <div className="p-1 rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-zinc-200">Default Quality</p>
                      <p className="text-sm text-zinc-500 mt-1">
                        Preferred stream quality when available
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {saved && (
                        <span className="text-sm text-yellow-500 font-medium animate-in fade-in slide-in-from-right-2 duration-300">
                          Saved
                        </span>
                      )}
                      <Select
                        value={preferences?.playback?.defaultQuality || "auto"}
                        onValueChange={handleQualityChange}
                      >
                        <SelectTrigger className="w-[180px] bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-yellow-500/20">
                          <SelectValue placeholder="Select quality" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
                          <SelectItem value="auto">Auto</SelectItem>
                          <SelectItem value="1080p">1080p60</SelectItem>
                          <SelectItem value="720p">720p60</SelectItem>
                          <SelectItem value="480p">480p</SelectItem>
                          <SelectItem value="360p">360p</SelectItem>
                          <SelectItem value="160p">160p</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Ad-Block Tab */}
          {activeTab === "adblock" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h2 className="text-2xl font-bold mb-1">Ad-Block</h2>
                <p className="text-zinc-400">Manage ad-blocking capabilities for Twitch streams.</p>
              </div>

              <div className="p-6 rounded-xl border border-[#27272a] bg-[#121214]">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-green-500/10 text-green-400">
                    <LuShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Client-Side Ad-Blocking</h3>
                    <p className="text-sm text-zinc-500">Bypass Twitch advertisements locally</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg bg-[#18181b]/50 border border-[#27272a]">
                  <div>
                    <p className="font-medium text-zinc-200">Enable Ad-Blocking</p>
                    <p className="text-sm text-zinc-500 mt-1">
                      Block Twitch ads using alternative player tokens
                    </p>
                  </div>
                  <Switch
                    checked={enableAdBlock}
                    onCheckedChange={setEnableAdBlock}
                    className="data-[state=checked]:!bg-green-500 data-[state=checked]:!border-green-500"
                  />
                </div>
                <div className="mt-4 p-4 rounded-lg bg-blue-500/5 border border-blue-500/10 text-sm text-blue-300/80 leading-relaxed">
                  This uses the VAFT technique to request ad-free streams via backup player types.
                  It works without external proxies. A shield icon will appear in the player when
                  active.
                </div>
              </div>
            </div>
          )}

          {/* Integrations Tab */}
          {activeTab === "integrations" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h2 className="text-2xl font-bold mb-1">Integrations</h2>
                <p className="text-zinc-400">Manage your connected accounts and services.</p>
              </div>

              {/* Auth Error Alert (Moved here) */}
              {error && (
                <div
                  className={`flex items-start gap-4 p-4 rounded-xl border mb-6 ${
                    error.platform === "twitch"
                      ? "bg-[#9146FF]/5 border-[#9146FF]/20 text-[#9146FF]"
                      : error.platform === "kick"
                        ? "bg-[#53FC18]/5 border-[#53FC18]/20 text-[#53FC18]"
                        : "bg-red-500/5 border-red-500/20 text-red-400"
                  }`}
                >
                  <LuCircleAlert size={20} className="flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium">
                      {error.platform === "twitch"
                        ? "Twitch Connection Error"
                        : error.platform === "kick"
                          ? "Kick Connection Error"
                          : "Authentication Error"}
                    </p>
                    <p className="text-sm mt-1 opacity-80 leading-relaxed">{error.message}</p>
                  </div>
                  <button
                    onClick={clearError}
                    className="text-sm font-medium hover:underline opacity-80 hover:opacity-100"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div className="p-6 rounded-xl border border-[#27272a] bg-[#121214]">
                <h3 className="font-semibold text-lg mb-4">Connected Accounts</h3>
                <AccountConnect />
              </div>
            </div>
          )}

          {/* Updates Tab */}
          {activeTab === "updates" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h2 className="text-2xl font-bold mb-1">Updates</h2>
                <p className="text-zinc-400">Manage application updates and release channels.</p>
              </div>

              <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                <div className="p-6 border-b border-[#27272a]">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                      <LuRefreshCw className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Software Update</h3>
                      <p className="text-sm text-zinc-500">
                        Current Version: v{appVersion ?? "0.0.0"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  {/* Pre-release Toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-zinc-200">Allow Pre-release Updates</p>
                      <p className="text-sm text-zinc-500 mt-1">
                        Receive beta and preview versions before stable release
                      </p>
                    </div>
                    <Switch
                      checked={allowPrerelease}
                      onCheckedChange={setAllowPrerelease}
                      className="data-[state=checked]:!bg-blue-500 data-[state=checked]:!border-blue-500"
                    />
                  </div>

                  {/* Check Button */}
                  <div className="flex items-center justify-between pt-6 border-t border-[#27272a]">
                    <div>
                      <p className="font-medium text-zinc-200">Check for Updates</p>
                      <p className="text-sm text-zinc-500 mt-1">
                        {status === "idle" && "Click to check for available updates"}
                        {status === "checking" && "Checking for updates..."}
                        {status === "not-available" && "You are on the latest version"}
                        {status === "available" && `Version ${updateInfo?.version} is available`}
                        {status === "downloading" && "Downloading update..."}
                        {status === "downloaded" && "Update ready to install"}
                        {status === "error" && "Failed to check for updates"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={checkForUpdates}
                      disabled={isChecking || isDownloading}
                      className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
                    >
                      <LuRefreshCw className={`w-4 h-4 mr-2 ${isChecking ? "animate-spin" : ""}`} />
                      Check Now
                    </Button>
                  </div>

                  {/* Errors */}
                  {hasError && updateError && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                      <LuTriangleAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm">{updateError}</p>
                      </div>
                    </div>
                  )}

                  {/* Update Available */}
                  {isUpdateAvailable && updateInfo && (
                    <div className="bg-[#18181b] rounded-lg border border-[#27272a] p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-white">
                            {updateInfo.releaseName || `Version ${updateInfo.version}`}
                          </p>
                          {updateInfo.releaseDate && (
                            <p className="text-xs text-zinc-500 mt-0.5">
                              Released {new Date(updateInfo.releaseDate).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        <Button size="sm" onClick={downloadUpdate} disabled={isDownloading}>
                          <LuDownload className="w-4 h-4 mr-2" />
                          Download Update
                        </Button>
                      </div>
                      {updateInfo.releaseNotes && (
                        <div className="text-sm text-zinc-400 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono bg-[#09090b] p-3 rounded border border-[#27272a]">
                          {updateInfo.releaseNotes}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Downloading */}
                  {isDownloading && progress && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Downloading...</span>
                        <span>{Math.round(progress.percent)}%</span>
                      </div>
                      <Progress value={progress.percent} className="h-2" />
                    </div>
                  )}

                  {/* Install */}
                  {isUpdateDownloaded && (
                    <Button onClick={installUpdate} className="w-full">
                      <LuRocket className="w-4 h-4 mr-2" /> Restart & Install
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* About Tab */}
          {activeTab === "about" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h2 className="text-2xl font-bold mb-1">About</h2>
                <p className="text-zinc-400">Application information.</p>
              </div>

              <div className="p-8 rounded-xl border border-[#27272a] bg-[#121214] flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
                  <LuRocket className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">StreamFusion</h3>
                  <div className="flex items-center justify-center gap-2 mt-1">
                    <p className="text-zinc-500">
                      v{versionInfo?.version ?? appVersion ?? "0.1.0"}
                    </p>
                    {versionInfo?.isPrerelease && (
                      <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                        Pre-release
                      </span>
                    )}
                  </div>
                </div>
                <div className="pt-6 text-sm text-zinc-500">
                  <p>Built with Electron + React + TailwindCSS</p>
                  <p className="mt-1">Designed for the best streaming experience.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  description,
  isActive,
  onClick,
}: {
  icon: any;
  label: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all duration-200 group relative",
        isActive
          ? "bg-[#3f3f46] text-white"
          : "text-zinc-400 hover:bg-[#27272a] hover:text-zinc-200"
      )}
    >
      <div
        className={cn(
          "p-2 rounded-md transition-colors",
          isActive
            ? "bg-[#18181b] text-white"
            : "bg-[#18181b] text-zinc-500 group-hover:text-zinc-300 group-hover:bg-[#3f3f46]"
        )}
      >
        <Icon size={24} strokeWidth={2.5} />
      </div>

      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-medium truncate", isActive ? "text-white" : "")}>{label}</p>
        <p
          className={cn(
            "text-[11px] truncate mt-0.5",
            isActive ? "text-zinc-300" : "text-zinc-600 group-hover:text-zinc-500"
          )}
        >
          {description}
        </p>
      </div>
    </button>
  );
}
