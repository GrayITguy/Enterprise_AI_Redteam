import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Shield, Zap, Target, ChevronRight, AlertTriangle, Calendar, Bell, Repeat, Search, X } from "lucide-react";

/** Convert a datetime-local string (YYYY-MM-DDTHH:MM) to ISO-8601. */
function localToIso(local: string): string {
  return new Date(local).toISOString();
}

/** Current time + n minutes formatted for datetime-local input. */
function defaultScheduleTime(offsetMinutes = 60): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  return d.toISOString().slice(0, 16);
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-red-500/40 text-red-400 bg-red-500/10",
  high: "border-orange-500/40 text-orange-400 bg-orange-500/10",
  medium: "border-yellow-500/40 text-yellow-400 bg-yellow-500/10",
  low: "border-green-500/40 text-green-400 bg-green-500/10",
};

function PluginCard({
  plugin,
  selected,
  onToggle,
}: {
  plugin: any;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      onClick={() => onToggle(plugin.id)}
      className={`cursor-pointer rounded-lg border p-3 transition-colors ${
        selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{plugin.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{plugin.description}</p>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <Badge
            variant="outline"
            className={`text-[10px] px-1 py-0 ${SEVERITY_COLORS[plugin.severity]}`}
          >
            {plugin.severity}
          </Badge>
          {plugin.owaspCategory && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {plugin.owaspCategory}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScanBuilder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultProjectId = searchParams.get("project") ?? "";

  const [selectedProjectId, setSelectedProjectId] = useState(defaultProjectId);
  const [selectedPreset, setSelectedPreset] = useState<string>("quick");
  const [selectedPlugins, setSelectedPlugins] = useState<Set<string>>(new Set());
  const [usePreset, setUsePreset] = useState(true);

  // Plugin search/filter state
  const [pluginSearch, setPluginSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);

  // Scheduler state
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<string>(defaultScheduleTime());
  const [recurrence, setRecurrence] = useState<"once" | "daily" | "weekly" | "monthly">("once");
  const [notifyOn, setNotifyOn] = useState<"always" | "failure" | "never">("always");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get("/projects").then((r) => r.data as any[]),
  });

  const { data: catalog } = useQuery({
    queryKey: ["scan-catalog"],
    queryFn: () => api.get("/scans/catalog").then((r) => r.data as any),
  });

  const plugins: any[] = catalog?.plugins ?? [];
  const presets: Record<string, any> = catalog?.presets ?? {};

  // When preset changes, sync plugin selection
  const handlePresetChange = (preset: string) => {
    setSelectedPreset(preset);
    if (presets[preset]) {
      setSelectedPlugins(new Set(presets[preset].plugins as string[]));
    }
  };

  // Initialize with quick preset
  useEffect(() => {
    if (presets.quick && selectedPlugins.size === 0) {
      setSelectedPlugins(new Set(presets.quick.plugins as string[]));
    }
  }, [presets]);

  const togglePlugin = (pluginId: string) => {
    const next = new Set(selectedPlugins);
    if (next.has(pluginId)) next.delete(pluginId);
    else next.add(pluginId);
    setSelectedPlugins(next);
    setUsePreset(false);
  };

  const createScanMutation = useMutation({
    mutationFn: async () => {
      const pluginIds =
        usePreset && selectedPreset
          ? (presets[selectedPreset]?.plugins as string[] ?? [])
          : Array.from(selectedPlugins);

      const body: Record<string, unknown> = {
        projectId: selectedProjectId,
        plugins: usePreset ? undefined : pluginIds,
        preset: usePreset ? selectedPreset : undefined,
        notifyOn: notifyOn === "never" ? null : notifyOn,
      };
      if (scheduleEnabled && scheduledAt) {
        body.scheduledAt = localToIso(scheduledAt);
        if (recurrence !== "once") body.recurrence = recurrence;
      }

      const res = await api.post("/scans", body);
      return res.data as any;
    },
    onSuccess: (scan) => {
      navigate(`/scans/${scan.id}`);
    },
  });

  const activePlugins: Set<string> = usePreset && selectedPreset
    ? new Set(presets[selectedPreset]?.plugins ?? [])
    : selectedPlugins;

  const toolGroups = plugins.reduce<Record<string, any[]>>((acc, plugin) => {
    if (!acc[plugin.tool]) acc[plugin.tool] = [];
    acc[plugin.tool].push(plugin);
    return acc;
  }, {});

  // Filtered view of all plugins (used in manual mode when a filter is active)
  const filteredPlugins = plugins.filter((p: any) => {
    const q = pluginSearch.toLowerCase();
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.owaspCategory?.toLowerCase().includes(q);
    const matchesSeverity = !severityFilter || p.severity === severityFilter;
    return matchesSearch && matchesSeverity;
  });
  const isFiltered = pluginSearch.trim() !== "" || severityFilter !== null;

  const canSubmit = selectedProjectId && activePlugins.size > 0;
  const scheduledInPast =
    scheduleEnabled && scheduledAt && new Date(scheduledAt) <= new Date();
  const error = (createScanMutation.error as any)?.response?.data?.error;

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">New Security Scan</h1>
        <p className="text-sm text-muted-foreground">Configure and launch an AI red team assessment</p>
      </div>

      {/* Step 1: Project */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4" />
            1. Select Target Project
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Choose a project..." />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} — {p.providerType} · {p.targetUrl}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {projects.length === 0 && (
            <Alert className="mt-3 max-w-md">
              <AlertDescription>
                No projects yet.{" "}
                <a href="/projects" className="text-primary underline">Create a project</a> first.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Plugins */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            2. Select Attack Plugins
          </CardTitle>
          <CardDescription>
            {activePlugins.size} plugin{activePlugins.size !== 1 ? "s" : ""} selected
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Preset toggles */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="use-preset" checked={usePreset} onCheckedChange={setUsePreset} />
              <Label htmlFor="use-preset" className="cursor-pointer">Use preset</Label>
            </div>
            {usePreset && (
              <div className="flex gap-2 flex-wrap">
                {Object.entries(presets).map(([key, preset]: [string, any]) => (
                  <Button
                    key={key}
                    variant={selectedPreset === key ? "default" : "outline"}
                    size="sm"
                    onClick={() => handlePresetChange(key)}
                  >
                    {key === "quick" && <Zap className="mr-1 h-3 w-3" />}
                    {preset.name}
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {preset.plugins.length}
                    </Badge>
                  </Button>
                ))}
              </div>
            )}
          </div>

          {usePreset && selectedPreset && presets[selectedPreset] && (
            <p className="text-sm text-muted-foreground">
              {presets[selectedPreset].description}
            </p>
          )}

          {/* Manual plugin grid */}
          {!usePreset && (
            <div className="space-y-3">
              {/* Search + severity filter bar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search plugins…"
                    value={pluginSearch}
                    onChange={(e) => setPluginSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                  {pluginSearch && (
                    <button
                      onClick={() => setPluginSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {/* Severity filter chips */}
                <div className="flex gap-1.5 flex-wrap">
                  {["critical", "high", "medium", "low"].map((sev) => (
                    <button
                      key={sev}
                      onClick={() => setSeverityFilter(severityFilter === sev ? null : sev)}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize transition-colors ${
                        severityFilter === sev
                          ? SEVERITY_COLORS[sev] + " ring-1 ring-current"
                          : "border-border text-muted-foreground hover:border-foreground/40"
                      }`}
                    >
                      {sev}
                    </button>
                  ))}
                </div>
                {isFiltered && (
                  <span className="text-xs text-muted-foreground">
                    {filteredPlugins.length} of {plugins.length}
                  </span>
                )}
              </div>

              {/* Flat filtered results */}
              {isFiltered ? (
                filteredPlugins.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-sm text-muted-foreground">
                    <Search className="mb-2 h-5 w-5 opacity-40" />
                    No plugins match your filter
                    <button
                      className="mt-2 text-xs text-primary underline"
                      onClick={() => { setPluginSearch(""); setSeverityFilter(null); }}
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {filteredPlugins.map((plugin: any) => (
                      <PluginCard
                        key={plugin.id}
                        plugin={plugin}
                        selected={activePlugins.has(plugin.id)}
                        onToggle={togglePlugin}
                      />
                    ))}
                  </div>
                )
              ) : (
                /* Tabbed view when no filter */
                <Tabs defaultValue={Object.keys(toolGroups)[0] ?? "promptfoo"}>
                  <TabsList className="flex-wrap h-auto">
                    {Object.keys(toolGroups).map((tool) => (
                      <TabsTrigger key={tool} value={tool} className="capitalize">
                        {tool}
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {toolGroups[tool].filter((p: any) => activePlugins.has(p.id)).length}
                          /{toolGroups[tool].length}
                        </Badge>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {Object.entries(toolGroups).map(([tool, toolPlugins]) => (
                    <TabsContent key={tool} value={tool} className="mt-4">
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(toolPlugins as any[]).map((plugin: any) => (
                          <PluginCard
                            key={plugin.id}
                            plugin={plugin}
                            selected={activePlugins.has(plugin.id)}
                            onToggle={togglePlugin}
                          />
                        ))}
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            3. Schedule &amp; Notifications (optional)
          </CardTitle>
          <CardDescription>Run immediately or set a future date, recurrence, and alert preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Schedule toggle + datetime */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Switch
                id="schedule-toggle"
                checked={scheduleEnabled}
                onCheckedChange={setScheduleEnabled}
              />
              <Label htmlFor="schedule-toggle" className="cursor-pointer">
                Schedule for a specific time
              </Label>
            </div>

            {scheduleEnabled && (
              <div className="space-y-2 pl-1">
                <Label htmlFor="scheduled-at" className="text-sm">
                  Start date &amp; time (your local timezone)
                </Label>
                <Input
                  id="scheduled-at"
                  type="datetime-local"
                  className="max-w-xs"
                  value={scheduledAt}
                  min={defaultScheduleTime(1)}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                {scheduledInPast ? (
                  <p className="text-sm text-destructive">
                    Scheduled time must be in the future. The scheduler checks every 5 minutes.
                  </p>
                ) : (
                  scheduledAt && (
                    <p className="text-sm text-muted-foreground">
                      Will run at{" "}
                      <span className="font-medium text-foreground">
                        {new Date(scheduledAt).toLocaleString()}
                      </span>
                    </p>
                  )
                )}
              </div>
            )}
          </div>

          {/* Recurrence picker — only shown when scheduling is enabled */}
          {scheduleEnabled && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-sm">
                <Repeat className="h-3.5 w-3.5" />
                Recurrence
              </Label>
              <div className="flex flex-wrap gap-2">
                {(["once", "daily", "weekly", "monthly"] as const).map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={recurrence === r ? "default" : "outline"}
                    onClick={() => setRecurrence(r)}
                    className="capitalize"
                  >
                    {r === "once" ? "Run once" : r}
                  </Button>
                ))}
              </div>
              {recurrence !== "once" && (
                <p className="text-xs text-muted-foreground">
                  After each run completes, the next scan will be automatically scheduled {recurrence === "daily" ? "24 hours" : recurrence === "weekly" ? "7 days" : "30 days"} later.
                </p>
              )}
            </div>
          )}

          {/* Notification settings — always visible */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-sm">
              <Bell className="h-3.5 w-3.5" />
              Email notifications
            </Label>
            <div className="flex flex-wrap gap-2">
              {([
                { value: "always", label: "Always" },
                { value: "failure", label: "Failures only" },
                { value: "never", label: "Never" },
              ] as const).map((opt) => (
                <Button
                  key={opt.value}
                  size="sm"
                  variant={notifyOn === opt.value ? "default" : "outline"}
                  onClick={() => setNotifyOn(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Launch */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
        <div>
          <p className="font-medium">
            {scheduleEnabled ? "Schedule scan" : "Ready to scan"}
          </p>
          <p className="text-sm text-muted-foreground">
            {activePlugins.size} plugin{activePlugins.size !== 1 ? "s" : ""} ·{" "}
            {selectedProjectId
              ? projects.find((p: any) => p.id === selectedProjectId)?.name ?? ""
              : "no project selected"}
            {scheduleEnabled && scheduledAt && !scheduledInPast && (
              <> · scheduled {new Date(scheduledAt).toLocaleString()}</>
            )}
            {scheduleEnabled && recurrence !== "once" && (
              <> · repeats {recurrence}</>
            )}
          </p>
        </div>
        <Button
          size="lg"
          disabled={!canSubmit || !!scheduledInPast || createScanMutation.isPending}
          onClick={() => createScanMutation.mutate()}
        >
          {createScanMutation.isPending ? (
            "Queuing..."
          ) : scheduleEnabled ? (
            <>Schedule Scan <Calendar className="ml-2 h-4 w-4" /></>
          ) : (
            <>Launch Scan <ChevronRight className="ml-2 h-4 w-4" /></>
          )}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
