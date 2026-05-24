"use client";

import { useTranslation } from "react-i18next";
import { GoPlus } from "react-icons/go";
import { LuCheck, LuChevronsUpDown } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RippleButton } from "@/components/ui/ripple";
import { cn } from "@/lib/utils";
import type { StoredProxy, VpnConfig } from "@/types";

interface ProxyVpnSelectorProps {
  storedProxies: StoredProxy[];
  vpnConfigs: VpnConfig[];
  selectedProxyId: string | undefined;
  onSelectedProxyIdChange: (value: string | undefined) => void;
  popoverOpen: boolean;
  onPopoverOpenChange: (open: boolean) => void;
  onAddProxyClick: () => void;
}

/**
 * Combined proxy + VPN picker used by both the anti-detect and the regular
 * browser configuration tabs of the create-profile dialog. VPN ids are
 * carried with the `vpn-` prefix in `selectedProxyId` so the parent only
 * tracks a single selection.
 */
export function ProxyVpnSelector({
  storedProxies,
  vpnConfigs,
  selectedProxyId,
  onSelectedProxyIdChange,
  popoverOpen,
  onPopoverOpenChange,
  onAddProxyClick,
}: ProxyVpnSelectorProps) {
  const { t } = useTranslation();
  const hasAny = storedProxies.length > 0 || vpnConfigs.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <Label>{t("createProfile.proxy.title")}</Label>
        <RippleButton
          size="sm"
          variant="outline"
          onClick={onAddProxyClick}
          className="px-2 h-7 text-xs"
        >
          <GoPlus className="mr-1 w-3 h-3" />{" "}
          {t("createProfile.proxy.addProxy")}
        </RippleButton>
      </div>
      {hasAny ? (
        <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={popoverOpen}
              className="w-full justify-between font-normal"
            >
              {(() => {
                if (!selectedProxyId) return t("createProfile.proxy.noProxy");
                if (selectedProxyId.startsWith("vpn-")) {
                  const vpn = vpnConfigs.find(
                    (v) => v.id === selectedProxyId.slice(4),
                  );
                  return vpn
                    ? `WG — ${vpn.name}`
                    : t("createProfile.proxy.noProxy");
                }
                const proxy = storedProxies.find(
                  (p) => p.id === selectedProxyId,
                );
                return proxy?.name ?? t("createProfile.proxy.noProxy");
              })()}
              <LuChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[240px] p-0" sideOffset={8}>
            <Command>
              <CommandInput placeholder={t("createProfile.proxy.search")} />
              <CommandList>
                <CommandEmpty>{t("createProfile.proxy.notFound")}</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="__none__"
                    onSelect={() => {
                      onSelectedProxyIdChange(undefined);
                      onPopoverOpenChange(false);
                    }}
                  >
                    <LuCheck
                      className={cn(
                        "mr-2 h-4 w-4",
                        !selectedProxyId ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {t("common.labels.none")}
                  </CommandItem>
                  {storedProxies.map((proxy) => (
                    <CommandItem
                      key={proxy.id}
                      value={proxy.name}
                      onSelect={() => {
                        onSelectedProxyIdChange(proxy.id);
                        onPopoverOpenChange(false);
                      }}
                    >
                      <LuCheck
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedProxyId === proxy.id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      {proxy.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {vpnConfigs.length > 0 && (
                  <CommandGroup heading="VPNs">
                    {vpnConfigs.map((vpn) => (
                      <CommandItem
                        key={vpn.id}
                        value={`vpn-${vpn.name}`}
                        onSelect={() => {
                          onSelectedProxyIdChange(`vpn-${vpn.id}`);
                          onPopoverOpenChange(false);
                        }}
                      >
                        <LuCheck
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedProxyId === `vpn-${vpn.id}`
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0 leading-tight mr-1"
                        >
                          WG
                        </Badge>
                        {vpn.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex gap-3 items-center p-3 text-sm rounded-md border text-muted-foreground">
          {t("createProfile.proxy.noProxiesAvailable")}
        </div>
      )}
    </div>
  );
}
