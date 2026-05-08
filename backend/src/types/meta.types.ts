export interface AdAccount {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  status: number;
}

export interface DateRange {
  since: string; // YYYY-MM-DD
  until: string;
}

export interface Insights {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpl: number;
  roas: number;
  conversions: number;
  reach: number;
  frequency: number;
  dateStart: string;
  dateStop: string;
}

export interface SpendSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  lifetime: number;
}

export interface AccountHealth {
  status: 'ACTIVE' | 'DISABLED' | 'UNSETTLED' | 'PENDING_RISK_REVIEW';
  disableReason?: string;
  amountSpent: number;
  balance: number;
  spendCap: number;
}

export interface Campaign {
  id: string;
  name: string;
  objective: string;
  status: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  createdTime: string;
}

export interface AdSet {
  id: string;
  name: string;
  campaignId: string;
  status: string;
  dailyBudget: number;
  optimizationGoal: string;
  billingEvent: string;
  targeting: Record<string, unknown>;
}

export interface Ad {
  id: string;
  name: string;
  adSetId: string;
  status: string;
  creative?: {
    title: string;
    body: string;
    imageUrl?: string;
  };
}

export interface CustomAudience {
  id: string;
  name: string;
  approximateCount: number;
  subtype: string;
}

export interface LookalikeAudience {
  id: string;
  name: string;
  approximateCount: number;
  originAudienceId: string;
  ratio: number;
}

export interface CreateCampaignParams {
  adAccountId: string;
  name: string;
  objective: string;
  status: 'PAUSED' | 'ACTIVE';
  specialAdCategories?: string[];
  dailyBudget?: number;
  lifetimeBudget?: number;
}

export interface CreateAdSetParams {
  campaignId: string;
  name: string;
  dailyBudget: number;
  targeting: Record<string, unknown>;
  optimizationGoal: string;
  billingEvent: string;
  bidStrategy?: string;
  status: 'PAUSED' | 'ACTIVE';
}

export interface CreateAdParams {
  adSetId: string;
  name: string;
  creative: {
    title: string;
    body: string;
    callToAction: {
      type: string;
      link: string;
    };
    imageHash?: string;
    videoId?: string;
    imageUrl?: string;
  };
  status: 'PAUSED' | 'ACTIVE';
}

export interface CreateAudienceParams {
  adAccountId: string;
  name: string;
  subtype: 'CUSTOM' | 'LOOKALIKE' | 'WEBSITE';
  description?: string;
  rule?: Record<string, unknown>;
}

export interface AdPlan {
  name: string;
  headline: string;
  bodyText: string;
  ctaType: string;
  destinationUrl: string;
  imageUrl?: string;
}

export interface AdSetPlan {
  name: string;
  dailyBudget: number;
  targeting: Record<string, unknown>;
  optimizationGoal: string;
  billingEvent: string;
  bidStrategy?: string;
  ads: AdPlan[];
}

export interface CampaignPlan {
  localId: string;
  adAccountId: string;
  name: string;
  objective: string;
  specialCategories?: string[];
  adSets: AdSetPlan[];
}

export interface PublishResult {
  success: boolean;
  campaignId: string;
  status: 'PAUSED_FOR_REVIEW' | 'ACTIVE';
  adSetIds: string[];
  adIds: string[];
  managerUrl: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface MCPStatus {
  connected: boolean;
  provider?: string;
  mcpUrl?: string;
  adAccountIds: string[];
  lastConnectedAt?: Date;
}

export type AdStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
