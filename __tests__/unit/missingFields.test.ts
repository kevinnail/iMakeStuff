import {
  getOverlapMissing,
  getPieceMissing,
  getSupplyMissing,
  getUseMissing,
} from '@/utils/missingFields';

const completePiece = {
  name: 'Flower pendant',
  finished: false,
  hasPhoto: false,
  notes: '',
  countTexts: null,
};

describe('getPieceMissing', () => {
  // Otherwise Save would show red on a form that has everything it needs.
  it('is empty for a complete form', () => {
    expect(getPieceMissing(completePiece)).toEqual([]);
  });

  // Otherwise a piece named only with spaces would save with no name.
  it('names a blank name as missing', () => {
    expect(getPieceMissing({ ...completePiece, name: '   ' })).toEqual(['name']);
  });

  // Otherwise a finished piece with no photo or description could be saved and never identified.
  it('needs a photo or notes once finished, and is satisfied by either', () => {
    const finished = { ...completePiece, finished: true };

    expect(getPieceMissing({ ...finished, notes: '  ' })).toEqual(['identity']);
    expect(getPieceMissing({ ...finished, hasPhoto: true })).toEqual([]);
    expect(getPieceMissing({ ...finished, notes: 'Blue swirl' })).toEqual([]);
  });

  // Otherwise counted prep could save with no count, and pieces using it would have nothing to divide its cost by.
  it('names the half of a count that is missing', () => {
    expect(
      getPieceMissing({ ...completePiece, countTexts: { amountText: '8', unitText: '' } }),
    ).toEqual(['countUnit']);
    expect(
      getPieceMissing({ ...completePiece, countTexts: { amountText: '0', unitText: 'points' } }),
    ).toEqual(['countNumber']);
    expect(
      getPieceMissing({ ...completePiece, countTexts: { amountText: '8', unitText: 'points' } }),
    ).toEqual([]);
  });
});

describe('getOverlapMissing', () => {
  // Otherwise Save would go ahead with times that overlap another entry, or refuse ones that don't.
  it('is missing only while the times overlap', () => {
    expect(getOverlapMissing(true)).toEqual(['overlap']);
    expect(getOverlapMissing(false)).toEqual([]);
  });
});

describe('getSupplyMissing', () => {
  // Otherwise a supply with a cost the app can't read would save, or a valid one would be refused.
  it('needs a name and a readable cost', () => {
    expect(getSupplyMissing('Tube', '12.50', null)).toEqual([]);
    expect(getSupplyMissing('Tube', 'twelve', null)).toEqual(['cost']);
    expect(getSupplyMissing('', '', null)).toEqual(['name', 'cost']);
  });

  // Otherwise a case with no count would save as a case of one, priced at the whole case.
  it('needs a count of 1 or more for a case', () => {
    expect(getSupplyMissing('Tube', '240', '16')).toEqual([]);
    expect(getSupplyMissing('Tube', '240', '')).toEqual(['caseCount']);
    expect(getSupplyMissing('Tube', '240', '0')).toEqual(['caseCount']);
  });
});

describe('getUseMissing', () => {
  // Otherwise Add would say the amount is wrong before anything is picked to take an amount of.
  it('asks only for a pick when nothing is chosen', () => {
    expect(getUseMissing(false, '', null)).toEqual(['item']);
  });

  // Otherwise a share the app can't read would be added to the piece.
  it('needs an amount that reads for the batch', () => {
    expect(getUseMissing(true, '', null)).toEqual(['amount']);
    expect(getUseMissing(true, '150', null)).toEqual(['amount']);
    expect(getUseMissing(true, '1/8', null)).toEqual([]);
    expect(getUseMissing(true, '1 1/2', 8)).toEqual([]);
  });
});
