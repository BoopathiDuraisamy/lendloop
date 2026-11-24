// Sign the (empty) request for the overdue-loans endpoint.
return [{ json: signForLendLoop({ requestedAt: new Date().toISOString() }) }];
