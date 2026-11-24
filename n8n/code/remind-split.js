// One item per overdue loan. Empty list => workflow ends quietly.
const res = $input.first().json;
if (!Array.isArray(res.loans)) throw new Error('Unexpected response from LendLoop overdue endpoint');
return res.loans.map((loan) => ({ json: loan }));
