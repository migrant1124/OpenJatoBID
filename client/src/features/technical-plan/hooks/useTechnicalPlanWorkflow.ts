import { useEffect, useState } from 'react';
import { technicalPlanStorage } from '../services/technicalPlanStorage';
import type { TechnicalPlanState } from '../types';
import { DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS } from '../../../shared/types/outline';

const initialState: TechnicalPlanState = {
  workflowKind: 'technical-plan',
  step: 'document-analysis',
  tenderFile: null,
  tenderFiles: [],
  originalPlanFile: null,
  projectOverview: '',
  techRequirements: '',
  bidAnalysisMode: 'key',
  bidAnalysisSelectedTaskIds: [],
  bidAnalysisTaskDefinitions: [],
  bidAnalysisTasks: {},
  bidAnalysisProgress: 0,
  bidSectionMode: 'multiple',
  bidSections: [],
  bidSectionExtractionStatus: 'idle',
  bidSectionExtractionError: undefined,
  outlineMode: 'aligned',
  outlineExpansionMode: 'ai-complement',
  outlineWordControlOptions: DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS,
  outlineWordControlSnapshot: undefined,
  referenceKnowledgeDocumentIds: [],
  bidSectionExtractionTask: undefined,
  bidAnalysisTask: undefined,
  outlineGenerationTask: undefined,
  globalFactsTask: undefined,
  globalFacts: [],
  contentGenerationTask: undefined,
  contentGenerationSections: {},
  contentGenerationPlans: {},
  contentGenerationRuntime: undefined,
  outlineData: null,
};

export function normalizeTechnicalPlanState(state: TechnicalPlanState): TechnicalPlanState {
  return {
    ...initialState,
    ...state,
    outlineExpansionMode: state.outlineExpansionMode || 'ai-complement',
    outlineWordControlOptions: state.outlineWordControlOptions || DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS,
  };
}

export function useTechnicalPlanWorkflow() {
  const [state, setState] = useState<TechnicalPlanState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadCache = async () => {
      try {
        const cachedState = await technicalPlanStorage.load();
        if (mounted && cachedState) {
          setState(normalizeTechnicalPlanState(cachedState));
        }
      } catch (error) {
        console.warn('技术方案缓存读取失败', error);
      } finally {
        if (mounted) {
          setHydrated(true);
        }
      }
    };

    loadCache();

    return () => {
      mounted = false;
    };
  }, []);

  return {
    hydrated,
    state,
    setState,
  };
}
