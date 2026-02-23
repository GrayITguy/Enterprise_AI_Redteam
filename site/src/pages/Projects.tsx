import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Trash2, ExternalLink, Server, Globe, Brain, ChevronRight, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  ollama: Brain,
  openai: Globe,
  anthropic: Brain,
  custom: Server,
};

const PROVIDER_LABELS: Record<string, string> = {
  ollama: "Ollama (Local)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  custom: "Custom / LiteLLM",
};

function CreateProjectForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    description: "",
    targetUrl: "",
    providerType: "ollama" as "ollama" | "openai" | "anthropic" | "custom",
    model: "",
    apiKey: "",
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/projects", {
        name: form.name,
        description: form.description || undefined,
        targetUrl: form.targetUrl,
        providerType: form.providerType,
        providerConfig: {
          model: form.model || undefined,
          apiKey: form.apiKey || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onSuccess();
    },
  });

  const error = (mutation.error as any)?.response?.data?.error;

  const placeholders: Record<string, string> = {
    ollama: "http://localhost:11434",
    openai: "https://api.openai.com",
    anthropic: "https://api.anthropic.com",
    custom: "http://localhost:4000",
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Project Name *</Label>
          <Input
            placeholder="Production RAG API"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Provider</Label>
          <Select
            value={form.providerType}
            onValueChange={(v) => setForm((f) => ({ ...f, providerType: v as typeof f.providerType }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Target URL *</Label>
        <Input
          placeholder={placeholders[form.providerType]}
          value={form.targetUrl}
          onChange={(e) => setForm((f) => ({ ...f, targetUrl: e.target.value }))}
          required
          type="url"
        />
        <p className="text-xs text-muted-foreground">
          {form.providerType === "ollama"
            ? "Ollama base URL — model selected during scan"
            : "OpenAI-compatible base URL"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Model (optional)</Label>
          <Input
            placeholder={form.providerType === "ollama" ? "llama3" : "gpt-4o"}
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          />
        </div>
        {form.providerType !== "ollama" && (
          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              placeholder="sk-..."
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Description (optional)</Label>
        <Input
          placeholder="Brief description of this target"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onSuccess}>Cancel</Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Creating..." : "Create Project"}
        </Button>
      </div>
    </form>
  );
}

export default function Projects() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get("/projects").then((r) => r.data as any[]),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Target AI models and APIs to test
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add Target Project</CardTitle>
            <CardDescription>
              Connect a model endpoint for security testing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateProjectForm onSuccess={() => setShowForm(false)} />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Server className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">No projects yet</p>
              <p className="text-sm text-muted-foreground">
                Add your first AI target to start testing
              </p>
            </div>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project: any) => {
            const Icon = PROVIDER_ICONS[project.providerType] ?? Server;
            return (
              <Card key={project.id} className="group relative hover:border-primary/50 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{project.name}</CardTitle>
                        <Badge variant="outline" className="mt-0.5 text-[10px] h-4">
                          {PROVIDER_LABELS[project.providerType]}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Archive project ${project.name}`}
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Archive project "${project.name}"?`)) {
                          deleteMutation.mutate(project.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{project.targetUrl}</span>
                  </div>
                  {project.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {project.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Added {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
                  </p>
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <Link to={`/scans/new?project=${project.id}`}>
                      Scan This Project
                      <ChevronRight className="ml-auto h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
