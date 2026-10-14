const finite = value => typeof value === 'number' && Number.isFinite(value);
const validRank = value => Number.isInteger(value) && value > 0;

export function referenceMark(row, assessment) {
  if (assessment.scoredRunners !== assessment.runnerPool || !row?.assessment?.available ||
      row.assessment.validFinishRows < 3 || !validRank(row.referenceRank)) return null;
  const labels = ['◎', '○', '▲', '△', '△', '☆'];
  const first = row.referenceRank - 1, last = first + Math.max(1, row.tiedCount || 1) - 1;
  // A tied group only receives a symbol when every covered position has the same symbol.
  return labels[first] && labels[first] === labels[last] ? labels[first] : null;
}

/** Attach the result-blind, all-runner history assessment to a new official-card mark audit. */
export function attachSavedReferenceAssessment(data, reference, markAlignment) {
  const assessment = reference?.assessment;
  if (!data?.ok || data.identityBasis !== 'official-numbered-card' ||
      !Array.isArray(assessment?.allRunners) || !assessment.allRunners.length) return data;

  const byName = new Map(assessment.allRunners.map(row => [row.horseName, row]));
  const marked = (data.audit?.marked || []).map(row => {
    const referenceRow = byName.get(row.horseName);
    const referenceScore = referenceRow?.assessment?.evidenceScore;
    const referenceRank = referenceRow?.referenceRank;
    const hasIntegratedRank = validRank(row.laboRank);
    const hasReferenceRank = validRank(referenceRank);
    const source = hasIntegratedRank ? 'integrated-model-snapshot' :
      hasReferenceRank ? 'history-reference-assessment' : 'unavailable';
    const laboRank = hasIntegratedRank ? row.laboRank : hasReferenceRank ? referenceRank : null;
    const laboScore = hasIntegratedRank ? row.laboScore : finite(referenceScore) ? referenceScore : null;
    return {
      ...row,
      laboRank,
      laboScore,
      laboRankSource: source,
      laboRankBasis: hasIntegratedRank ? 'stored-integrated-model' :
        hasReferenceRank ? (assessment.scoredRunners === assessment.runnerPool ? 'all-official-runners' : 'scored-runners-only') : 'unavailable',
      referenceRank: hasReferenceRank ? referenceRank : null,
      referenceScore: finite(referenceScore) ? referenceScore : null,
      laboReferenceMark: referenceMark(referenceRow, assessment),
      alignment: hasIntegratedRank || !hasReferenceRank ? row.alignment : markAlignment(row.mark, referenceRank),
    };
  });

  const storedAssessment = {
    modelVersion: assessment.modelVersion,
    trackAssumption: assessment.trackAssumption,
    trackBasis: assessment.trackBasis,
    runnerPool: assessment.runnerPool,
    scoredRunners: assessment.scoredRunners,
    scoreMeaning: '過去走の参考指数。的中確率・検証済み予測ではありません。',
    allRunners: assessment.allRunners.map(row => ({
      horseNo: row.horseNo,
      horseName: row.horseName,
      referenceRank: row.referenceRank,
      tiedCount: row.tiedCount,
      mark: referenceMark(row, assessment),
      available: Boolean(row.assessment?.available),
      evidenceScore: finite(row.assessment?.evidenceScore) ? row.assessment.evidenceScore : null,
      validFinishRows: row.assessment?.validFinishRows ?? 0,
      modelCoveragePct: row.assessment?.modelCoveragePct ?? null,
      components: row.assessment?.components ?? null,
    })),
    guardrails: {
      allOfficialRunnersIncluded: assessment.allRunners.length === assessment.runnerPool,
      humanMarksUsedInScore: false,
      targetResultUsed: false,
      noForcedTieBreak: assessment.guardrails?.noForcedTieBreak === true,
      lockedPredictionsModified: false,
      automaticMarksAssigned: true,
      validatedFinalPrediction: false,
      retrospectiveAccuracyCreditGranted: false,
    },
  };
  return {
    ...data,
    audit: {
      ...data.audit,
      marked,
      summary: Object.fromEntries(['aligned', 'watch', 'conflict', 'unscored'].map(level => [level, marked.filter(row => row.alignment?.level === level).length])),
      highReviewCount: marked.filter(row => ['high', 'critical'].includes(row.alignment?.reviewPriority)).length,
      referenceAssessment: storedAssessment,
      guardrails: {
        ...data.audit?.guardrails,
        referenceAssessmentStoredWithRevision: true,
        userMarksNeverChangeLABORank: true,
      },
    },
  };
}
