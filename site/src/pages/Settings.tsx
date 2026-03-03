import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users, Copy, CheckCircle, Plus, Mail, Send, Sparkles,
  Save, AlertCircle, Info, RefreshCw, Wifi, WifiOff,
} from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";

export default function Settings() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  const createInviteMutation = useMutation({
    mutationFn: () => api.post("/auth/invite", { expiresInDays: 7 }),
    onSuccess: (res) => {
      setInviteResult(res.data.code);
    },
  });

  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const copyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedCode(null), 2000);
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Platform configuration and user management</p>
      </div>

      {/* Current user */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{user?.email}</p>
              <p className="text-sm text-muted-foreground capitalize">{user?.role} account</p>
            </div>
            <Badge variant={user?.role === "admin" ? "default" : "secondary"} className="capitalize">
              {user?.role}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Invite codes (admin only) */}
      {user?.role === "admin" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Team Invites
            </CardTitle>
            <CardDescription>
              Generate invite codes to add team members. Codes expire after 7 days.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={() => createInviteMutation.mutate()}
              disabled={createInviteMutation.isPending}
            >
              <Plus className="mr-2 h-4 w-4" />
              {createInviteMutation.isPending ? "Generating..." : "Generate Invite Code"}
            </Button>

            {inviteResult && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium mb-1">Invite code generated</p>
                      <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
                        {inviteResult}
                      </code>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyCode(inviteResult)}
                    >
                      {copiedCode === inviteResult ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Share this code with your team member. They'll need it to register at /setup.
                    Valid for 7 days.
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* SMTP Settings (admin only) */}
      {user?.role === "admin" && <SmtpSettings />}

      {/* Remediation Settings (admin only) */}
      {user?.role === "admin" && <RemediationSettings />}

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Enterprise AI Red Team Platform v1.0.0</p>
          <p>
            Combines{" "}
            {["Promptfoo", "Garak", "PyRIT", "DeepTeam"].map((t, i, arr) => (
              <span key={t}>
                <span className="text-foreground">{t}</span>
                {i < arr.length - 1 ? ", " : ""}
              </span>
            ))}{" "}
            in one dashboard.
          </p>
          <p>MIT License — enterpriseairedteam.com</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── SMTP Settings Card ─────────────────────────────────────────────────────

function SmtpSettings() {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [password, setPassword] = useState("");
  const [fromAddr, setFromAddr] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [envConfigured, setEnvConfigured] = useState(false);

  const [testEmail, setTestEmail] = useState("");
  const [showTestInput, setShowTestInput] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["settings-smtp"],
    queryFn: () => api.get("/settings/smtp").then((r) => r.data),
  });

  useEffect(() => {
    if (data) {
      setHost(data.host ?? "");
      setPort(data.port ?? "587");
      setSecure(data.secure ?? false);
      setSmtpUser(data.user ?? "");
      setHasPassword(data.hasPassword ?? false);
      setFromAddr(data.from ?? "");
      setEnvConfigured(data.envConfigured ?? false);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put("/settings/smtp", {
        host,
        port,
        secure,
        user: smtpUser,
        ...(password ? { password } : {}),
        from: fromAddr,
      }),
    onSuccess: () => {
      setSaveMsg("SMTP settings saved");
      setHasPassword(!!password || hasPassword);
      setPassword("");
      setTimeout(() => setSaveMsg(null), 3000);
    },
    onError: (err: any) => {
      setSaveMsg(err?.response?.data?.error ?? "Failed to save");
    },
  });

  const testMutation = useMutation({
    mutationFn: () => api.post("/settings/smtp/test", { toEmail: testEmail }),
    onSuccess: () => setTestMsg({ ok: true, text: "Test email sent!" }),
    onError: (err: any) =>
      setTestMsg({
        ok: false,
        text: err?.response?.data?.error ?? "Failed to send",
      }),
  });

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" />
          SMTP / Email Notifications
        </CardTitle>
        <CardDescription>
          Configure outgoing email for scan completion notifications.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {envConfigured && !host && (
          <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-muted-foreground">
            <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
            <span>
              SMTP is currently configured via environment variables. Settings saved here will take
              precedence.
            </span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smtp-host">SMTP Host</Label>
            <Input
              id="smtp-host"
              placeholder="smtp.example.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-port">Port</Label>
            <Input
              id="smtp-port"
              placeholder="587"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            id="smtp-secure"
            checked={secure}
            onCheckedChange={setSecure}
          />
          <Label htmlFor="smtp-secure" className="text-sm">
            Use TLS/SSL (secure connection)
          </Label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smtp-user">Username</Label>
            <Input
              id="smtp-user"
              placeholder="user@example.com"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-pass">Password</Label>
            <Input
              id="smtp-pass"
              type="password"
              placeholder={hasPassword ? "(saved)" : ""}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="smtp-from">From Address</Label>
          <Input
            id="smtp-from"
            type="email"
            placeholder="no-reply@example.com"
            value={fromAddr}
            onChange={(e) => setFromAddr(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !host || !fromAddr}
          >
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>

          {!showTestInput ? (
            <Button
              variant="outline"
              onClick={() => setShowTestInput(true)}
              disabled={!host}
            >
              <Send className="mr-2 h-4 w-4" />
              Send Test Email
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                type="email"
                placeholder="recipient@example.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="w-56"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || !testEmail}
              >
                {testMutation.isPending ? "Sending..." : "Send"}
              </Button>
            </div>
          )}
        </div>

        {saveMsg && (
          <p className="text-sm text-green-500">{saveMsg}</p>
        )}
        {testMsg && (
          <p className={`text-sm ${testMsg.ok ? "text-green-500" : "text-destructive"}`}>
            {testMsg.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Remediation AI Settings Card ───────────────────────────────────────────

function RemediationSettings() {
  const [enabled, setEnabled] = useState(true);
  const [providerType, setProviderType] = useState("project");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Model autodetection state
  const [detectedModels, setDetectedModels] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [modelStatus, setModelStatus] = useState<{
    checking: boolean;
    error?: string;
  }>({ checking: false });

  const { data, isLoading } = useQuery({
    queryKey: ["settings-remediation"],
    queryFn: () => api.get("/settings/remediation").then((r) => r.data),
  });

  useEffect(() => {
    if (data) {
      setEnabled(data.enabled ?? true);
      setProviderType(data.providerType ?? "project");
      setModel(data.providerConfig?.model ?? "");
      setEndpoint(data.providerConfig?.endpoint ?? "");
      setHasApiKey(data.providerConfig?.hasApiKey ?? false);
    }
  }, [data]);

  // Auto-detect models when endpoint or provider changes
  const fetchModels = useCallback(
    async (pt: string, ep: string, key?: string) => {
      if (pt === "project") return;
      // Ollama/custom need an endpoint; OpenAI/Anthropic can work without one
      if ((pt === "ollama" || pt === "custom") && !ep) return;

      setModelStatus({ checking: true });
      setDetectedModels([]);
      try {
        const resp = await api.post("/settings/models", {
          providerType: pt,
          endpoint: ep || undefined,
          apiKey: key || undefined,
        });
        const models = resp.data.models as Array<{ id: string; name: string }>;
        setDetectedModels(models);
        setModelStatus({ checking: false });
        // Auto-select first model if none selected
        if (models.length > 0 && !model) {
          setModel(models[0].id);
        }
      } catch (err: any) {
        const msg =
          err?.response?.data?.error ?? "Could not detect models";
        setModelStatus({ checking: false, error: msg });
      }
    },
    [model]
  );

  // Debounced auto-detect for Ollama/custom on endpoint change
  useEffect(() => {
    if (providerType !== "ollama" && providerType !== "custom") return;
    if (!endpoint) {
      setDetectedModels([]);
      return;
    }
    const timer = setTimeout(() => fetchModels(providerType, endpoint, apiKey), 800);
    return () => clearTimeout(timer);
  }, [endpoint, providerType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect for Anthropic (static list, fires immediately)
  useEffect(() => {
    if (providerType === "anthropic") {
      fetchModels("anthropic", "", "");
    }
  }, [providerType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset detected models when provider type changes
  useEffect(() => {
    setDetectedModels([]);
    setModelStatus({ checking: false });
  }, [providerType]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const needsApiKey = ["openai", "anthropic", "custom"].includes(providerType);
      const needsEndpoint = ["ollama", "custom"].includes(providerType);
      return api.put("/settings/remediation", {
        enabled,
        providerType,
        providerConfig: providerType !== "project"
          ? {
              ...(needsApiKey && apiKey ? { apiKey } : {}),
              ...(model ? { model } : {}),
              ...(needsEndpoint && endpoint ? { endpoint } : {}),
            }
          : undefined,
      });
    },
    onSuccess: () => {
      setSaveMsg("Remediation settings saved");
      if (apiKey) setHasApiKey(true);
      setApiKey("");
      setTimeout(() => setSaveMsg(null), 3000);
    },
    onError: (err: any) => {
      setSaveMsg(err?.response?.data?.error ?? "Failed to save");
    },
  });

  if (isLoading) return null;

  const showProviderFields = providerType !== "project";
  const showApiKey = ["openai", "anthropic", "custom"].includes(providerType);
  const showEndpoint = ["ollama", "custom"].includes(providerType);

  const defaultModel =
    providerType === "anthropic"
      ? "claude-haiku-4-5-20251001"
      : providerType === "openai"
        ? "gpt-4o-mini"
        : providerType === "ollama"
          ? "llama3"
          : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          AI Remediation
        </CardTitle>
        <CardDescription>
          Configure the AI provider used for generating remediation plans. By default, each
          project's own LLM provider is used.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id="rem-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <Label htmlFor="rem-enabled" className="text-sm">
            Enable AI Remediation
          </Label>
        </div>

        {enabled && (
          <>
            <div className="space-y-2">
              <Label>Remediation Provider</Label>
              <Select
                value={providerType}
                onValueChange={(v) => {
                  setProviderType(v);
                  setModel("");
                  setEndpoint("");
                  setApiKey("");
                  setHasApiKey(false);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Use Project's Provider (default)</SelectItem>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="custom">Custom (OpenAI-compatible)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showProviderFields && (
              <div className="space-y-4 rounded-md border p-4">
                {showEndpoint && (
                  <div className="space-y-2">
                    <Label htmlFor="rem-endpoint">Endpoint URL</Label>
                    <Input
                      id="rem-endpoint"
                      placeholder={
                        providerType === "ollama"
                          ? "http://localhost:11434"
                          : "https://api.example.com/v1"
                      }
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                    />
                  </div>
                )}

                {showApiKey && (
                  <div className="space-y-2">
                    <Label htmlFor="rem-apikey">API Key</Label>
                    <Input
                      id="rem-apikey"
                      type="password"
                      placeholder={hasApiKey ? "(saved)" : "sk-..."}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </div>
                )}

                {/* Model selector: dropdown when models detected, text input as fallback */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="rem-model">Model</Label>
                    <div className="flex items-center gap-2">
                      {modelStatus.checking && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          Detecting...
                        </span>
                      )}
                      {!modelStatus.checking && detectedModels.length > 0 && (
                        <span className="flex items-center gap-1.5 text-xs text-green-500">
                          <Wifi className="h-3 w-3" />
                          {detectedModels.length} model{detectedModels.length !== 1 ? "s" : ""} found
                        </span>
                      )}
                      {!modelStatus.checking && modelStatus.error && (
                        <span className="flex items-center gap-1.5 text-xs text-destructive">
                          <WifiOff className="h-3 w-3" />
                          {modelStatus.error}
                        </span>
                      )}
                      {providerType !== "anthropic" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => fetchModels(providerType, endpoint, apiKey)}
                          disabled={modelStatus.checking}
                        >
                          <RefreshCw className={`h-3 w-3 mr-1 ${modelStatus.checking ? "animate-spin" : ""}`} />
                          Detect
                        </Button>
                      )}
                    </div>
                  </div>

                  {detectedModels.length > 0 ? (
                    <Select value={model} onValueChange={setModel}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {detectedModels.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="rem-model"
                      placeholder={defaultModel}
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />
                  )}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex items-center gap-2">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>

        {saveMsg && (
          <p className="text-sm text-green-500">{saveMsg}</p>
        )}
      </CardContent>
    </Card>
  );
}
