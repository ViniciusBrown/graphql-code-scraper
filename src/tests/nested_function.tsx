export function nestedFunctionTest(tracked_nested: { testSubFieldString: any; testSubFieldNumber: any; testSubFieldObject: { testGrandChildString: any } }){
	// this function will receive the tracked_variable.testFieldsSubObject and access its variables directly
	const usage1 = tracked_nested.testSubFieldString
	const usage2 = tracked_nested.testSubFieldNumber
	const usage3 = tracked_nested.testSubFieldObject.testGrandChildString
}