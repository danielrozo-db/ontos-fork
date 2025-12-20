import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Settings as SettingsIcon, ShieldX, Loader2, Save } from 'lucide-react';
import RolesSettings from '@/components/settings/roles-settings';
import SemanticModelsSettings from '@/components/settings/semantic-models-settings';
import TagsSettings from '@/components/settings/tags-settings';
import JobsSettings from '@/components/settings/jobs-settings';
import { usePermissions } from '@/stores/permissions-store';
import { FeatureAccessLevel } from '@/types/settings';
import { useToast } from '@/hooks/use-toast';

interface AppSettings {
  id: string;
  name: string;
  value: any;
  enableBackgroundJobs: boolean;
  workspaceDeploymentPath: string;
  databricksHost: string;
  databricksToken: string;
  databricksWarehouseId: string;
  databricksCatalog: string;
  databricksSchema: string;
  gitRepoUrl: string;
  gitBranch: string;
  gitToken: string;
}

export default function Settings() {
  const { t } = useTranslation(['settings', 'common']);
  const { isLoading: permissionsLoading, hasPermission } = usePermissions();
  const { toast } = useToast();
  
  // Check if user has at least READ_ONLY access to settings
  const hasSettingsAccess = hasPermission('settings', FeatureAccessLevel.READ_ONLY);
  const hasWriteAccess = hasPermission('settings', FeatureAccessLevel.READ_WRITE);
  
  // Legacy general/databricks/git settings state (kept for existing tabs)
  const [settings, setSettings] = useState<AppSettings>({
    id: '',
    name: '',
    value: null,
    enableBackgroundJobs: false,
    workspaceDeploymentPath: '',
    databricksHost: '',
    databricksToken: '',
    databricksWarehouseId: '',
    databricksCatalog: '',
    databricksSchema: '',
    gitRepoUrl: '',
    gitBranch: '',
    gitToken: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch current settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/settings');
        if (response.ok) {
          const data = await response.json();
          setSettings(prev => ({
            ...prev,
            workspaceDeploymentPath: data.workspace_deployment_path || '',
          }));
        }
      } catch (error) {
        console.error('Failed to fetch settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSaveGeneralSettings = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_deployment_path: settings.workspaceDeploymentPath,
        }),
      });
      if (response.ok) {
        toast({
          title: t('settings:general.messages.saveSuccess', 'Settings saved successfully'),
        });
      } else {
        throw new Error('Failed to save settings');
      }
    } catch (error) {
      toast({
        title: t('settings:general.messages.saveError', 'Failed to save settings'),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };
  
  // Show loading while permissions are being fetched
  if (permissionsLoading) {
    return (
      <div className="py-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  // Show access denied if user doesn't have settings access
  if (!hasSettingsAccess) {
    return (
      <div className="py-6">
        <div className="max-w-2xl mx-auto">
          <Alert variant="destructive" className="border-2">
            <ShieldX className="h-5 w-5" />
            <AlertTitle className="text-lg font-semibold">
              {t('settings:accessDenied.title', 'Access Denied')}
            </AlertTitle>
            <AlertDescription className="mt-2">
              <p className="mb-4">
                {t('settings:accessDenied.message', 'You do not have permission to access the Settings page. This page is restricted to users with administrative privileges.')}
              </p>
              <p className="text-sm">
                {t('settings:accessDenied.action', 'If you believe you should have access, please contact your administrator or ')}
                <Link to="/" className="font-semibold underline hover:text-destructive-foreground">
                  {t('settings:accessDenied.returnHome', 'return to the home page')}
                </Link>
                {t('settings:accessDenied.requestRole', ' to request an appropriate role.')}
              </p>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // Jobs save is handled within JobsSettings; keep no-op here to preserve structure

  // No job toggling here (moved into JobsSettings)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!settings) return;
    const { name, value } = e.target;
    setSettings({ ...settings, [name]: value });
  };

  const handleSwitchChange = (checked: boolean) => {
    if (!settings) return;
    setSettings({ ...settings, enableBackgroundJobs: checked });
  };

  return (
    <div className="py-6">
      <h1 className="text-3xl font-bold mb-6 flex items-center gap-2">
        <SettingsIcon className="w-8 h-8" /> {t('settings:title')}
      </h1>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList>
          <TabsTrigger value="general">{t('settings:tabs.general')}</TabsTrigger>
          <TabsTrigger value="databricks">{t('settings:tabs.databricks')}</TabsTrigger>
          <TabsTrigger value="git">{t('settings:tabs.git')}</TabsTrigger>
          <TabsTrigger value="jobs">{t('settings:tabs.jobs')}</TabsTrigger>
          <TabsTrigger value="roles">{t('settings:tabs.roles')}</TabsTrigger>
          <TabsTrigger value="tags">{t('settings:tabs.tags')}</TabsTrigger>
          <TabsTrigger value="semantic-models">{t('settings:tabs.semanticModels')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings:general.title')}</CardTitle>
              <CardDescription>{t('settings:general.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="background-jobs"
                  checked={settings.enableBackgroundJobs}
                  onCheckedChange={handleSwitchChange}
                />
                <Label htmlFor="background-jobs">{t('settings:general.enableBackgroundJobs')}</Label>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="workspaceDeploymentPath">
                  {t('settings:general.workspaceDeploymentPath.label', 'Workspace Deployment Path')}
                </Label>
                <Input
                  id="workspaceDeploymentPath"
                  name="workspaceDeploymentPath"
                  value={settings.workspaceDeploymentPath}
                  onChange={handleChange}
                  placeholder={t('settings:general.workspaceDeploymentPath.placeholder', '/Workspace/Users/user@domain.com/ontos-workflows')}
                  disabled={!hasWriteAccess || isLoading}
                />
                <p className="text-sm text-muted-foreground">
                  {t('settings:general.workspaceDeploymentPath.help', 'Path in Databricks workspace where workflow files are deployed for background jobs.')}
                </p>
              </div>
            </CardContent>
            {hasWriteAccess && (
              <CardFooter>
                <Button onClick={handleSaveGeneralSettings} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  {t('settings:general.saveButton', 'Save Settings')}
                </Button>
              </CardFooter>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="databricks">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings:databricks.title')}</CardTitle>
              <CardDescription>{t('settings:databricks.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="host">{t('settings:databricks.labels.host')}</Label>
                <Input
                  id="host"
                  name="databricksHost"
                  value={settings.databricksHost}
                  onChange={handleChange}
                  placeholder={t('settings:databricks.placeholders.host')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token">{t('settings:databricks.labels.token')}</Label>
                <Input
                  id="token"
                  name="databricksToken"
                  type="password"
                  value={settings.databricksToken}
                  onChange={handleChange}
                  placeholder={t('settings:databricks.placeholders.token')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="warehouse">{t('settings:databricks.labels.warehouseId')}</Label>
                <Input
                  id="warehouse"
                  name="databricksWarehouseId"
                  value={settings.databricksWarehouseId}
                  onChange={handleChange}
                  placeholder={t('settings:databricks.placeholders.warehouseId')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="catalog">{t('settings:databricks.labels.catalog')}</Label>
                <Input
                  id="catalog"
                  name="databricksCatalog"
                  value={settings.databricksCatalog}
                  onChange={handleChange}
                  placeholder={t('settings:databricks.placeholders.catalog')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schema">{t('settings:databricks.labels.schema')}</Label>
                <Input
                  id="schema"
                  name="databricksSchema"
                  value={settings.databricksSchema}
                  onChange={handleChange}
                  placeholder={t('settings:databricks.placeholders.schema')}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="git">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings:git.title')}</CardTitle>
              <CardDescription>{t('settings:git.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="repo">{t('settings:git.labels.repoUrl')}</Label>
                <Input
                  id="repo"
                  name="gitRepoUrl"
                  value={settings.gitRepoUrl}
                  onChange={handleChange}
                  placeholder={t('settings:git.placeholders.repoUrl')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch">{t('settings:git.labels.branch')}</Label>
                <Input
                  id="branch"
                  name="gitBranch"
                  value={settings.gitBranch}
                  onChange={handleChange}
                  placeholder={t('settings:git.placeholders.branch')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="git-token">{t('settings:git.labels.token')}</Label>
                <Input
                  id="git-token"
                  name="gitToken"
                  type="password"
                  value={settings.gitToken}
                  onChange={handleChange}
                  placeholder={t('settings:git.placeholders.token')}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs">
          <JobsSettings />
        </TabsContent>

        <TabsContent value="roles">
            <RolesSettings />
        </TabsContent>
        <TabsContent value="tags">
            <TagsSettings />
        </TabsContent>
        <TabsContent value="semantic-models">
            <SemanticModelsSettings />
        </TabsContent>
      </Tabs>

      <div className="mt-6" />
    </div>
  );
} 