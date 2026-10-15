(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PostMirrorSamples = api;
})(globalThis, function () {
  'use strict';

  // Japan Post manual examples; address numbers are kept before truncation.
  const version = '2026-10-15';
  const barcodes = [
    {
      labelKey: 'sample.calculation', sourcePages: ['p17', 'p21'], version,
      postalCode: '1000013', addressNumber: '1-3-2-503'
    },
    {
      labelKey: 'sample.letterA', sourcePages: ['p06'], version,
      postalCode: '3501106', addressNumber: '22-1A308'
    },
    {
      labelKey: 'sample.individual', sourcePages: ['p22'], version,
      postalCode: '1008792', addressNumber: ''
    },
    {
      labelKey: 'sample.poBox', sourcePages: ['p22'], version,
      postalCode: '9808691', addressNumber: '215'
    },
    {
      labelKey: 'sample.twoLetters', sourcePages: ['p25'], version,
      postalCode: '6230011', addressNumber: '6-7LB106'
    },
    {
      labelKey: 'sample.truncated', sourcePages: ['p25'], version,
      postalCode: '9100067', addressNumber: '3-80-25J1-2B'
    },
    {
      labelKey: 'sample.hyphenCD', sourcePages: ['p25'], version,
      postalCode: '4070033', addressNumber: '400'
    },
    {
      labelKey: 'sample.cc8', sourcePages: ['p25'], version,
      postalCode: '0140113', addressNumber: '60-1'
    }
  ];
  const extraction = [
    { addressB: '東3丁目-20-5　郵便・A&bコーポB604号', sourcePages: ['p19'], version },
    { addressB: '十一丁目六番地一号　郵便タワー601', sourcePages: ['p25'], version },
    { addressB: '6丁目7-14　ABCビル2F', sourcePages: ['p25'], version }
  ];
  const question2 = {
    addressB: '1丁目3番2号　郵便プラザ503室', sourcePages: ['p17'], version
  };
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  return freeze({ barcodes, extraction, question2 });
});
