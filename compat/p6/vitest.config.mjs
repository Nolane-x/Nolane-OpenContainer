export default {
  test:{
    globals:true,
    environment:'node',
    include:['compat/p6/vitest-smoke.test.ts'],
    passWithNoTests:false,
    watch:false,
    isolate:true
  }
};
