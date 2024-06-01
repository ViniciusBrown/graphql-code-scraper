function nestedFunctionTest(tracked_nested: { testSubFieldString: any; testSubFieldNumber: any; testSubFieldObject: { testGrandChildString: any } }){
	// this function will receive the tracked_variable.testFieldsSubObject and access its variables directly
	const usage1 = tracked_nested.testSubFieldString
	const usage2 = tracked_nested.testSubFieldNumber
	const usage3 = tracked_nested.testSubFieldObject.testGrandChildString
}

export function outerFunction(tracked_two: { testFieldsString: any; testFieldsSubObject: any; testFieldsNumber?: number; unusedVariable?: boolean; testClassSentObj?: { testClassSubFieldString: string; testClassSubFieldBoolean: boolean; testClassSubFieldObject: { testClassGrandChildString: string } }; unusedTestVar?: string; JSXChildrenTest?: string }){
	// this function on top of normal accesses will call the nestedFunctionTest to
	// check if those variables are being tracked and references back.
	const usage1 = tracked_two.testFieldsString
	const usage2 = tracked_two.testFieldsSubObject
    const usage3 = usage2.testSubFieldNull
	const usage4 = nestedFunctionTest(usage2)
	return null
}

function outerFunction1(){
	
}