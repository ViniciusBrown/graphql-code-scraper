import { Component } from "react";
import { Fragment } from "react/jsx-runtime";

function nestedFunctionTest(tracked_nested: { testSubFieldString: any; testSubFieldNumber: any; testSubFieldObject: { testGrandChildString: any } }){
	// this function will receive the tracked_variable.testFieldsSubObject and access its variables directly
	const usage1 = tracked_nested.testSubFieldString
	const usage2 = tracked_nested.testSubFieldNumber
	const usage3 = tracked_nested.testSubFieldObject.testGrandChildString
}

export function outerFunction2(tracked_two: { testFieldsString: any; testFieldsSubObject: any; testFieldsNumber?: number; unusedVariable?: boolean; testClassSentObj?: { testClassSubFieldString: string; testClassSubFieldBoolean: boolean; testClassSubFieldObject: { testClassGrandChildString: string } }; unusedTestVar?: string; JSXChildrenTest?: string }){
	// this function on top of normal accesses will call the nestedFunctionTest to
	// check if those variables are being tracked and references back.
	const usage1 = tracked_two.testFieldsString
	const usage2 = tracked_two.testFieldsSubObject
    const usage3 = usage2.testSubFieldNull
	if(tracked_two.ifStatementTestBoolean){
    	const usage4 = () => nestedFunctionTest(usage2)
    }
	return null
}

function outer_function1({ tracked_one }){
	const usage1 = tracked_one.testFieldsNumber + 1
	const usage2 = tracked_one.testFieldsString
	return null
}
function GenericReactFunctionComponent(props: { class_tracked_variable: any }){
	function someClassFunction(){
		const usage1 = props.class_tracked_variable
	  	const usage2 = someOtherNestedFunction(usage1)
	}
	function someOtherClassFunction(tracked_class_1: { testClassSubFieldBoolean: any }) {
		const usage1 = tracked_class_1.testClassSubFieldBoolean
	}
	function someOtherNestedFunction(tracked_class_2: { testClassSubFieldObject: { testClassGrandChildString: any } }) {
		const usage1 = tracked_class_2.testClassSubFieldObject.testClassGrandChildString
	}
	someClassFunction()
	someOtherClassFunction(props.class_tracked_variable)
	return (
		<></>
	);
}
class GenericReactClassComponent extends Component<any, any> {
	someClassFunction() {
	  const usage1 = this.props.class_tracked_variable
	  const usage2 = this.someOtherNestedFunction(usage1)
	}
	someOtherClassFunction(tracked_class_1: { testClassSubFieldBoolean: any }) {
		const usage1 = tracked_class_1.testClassSubFieldBoolean
	}
	someOtherNestedFunction(tracked_class_2: { testClassSubFieldObject: { testClassGrandChildString: any } }) {
		const usage1 = tracked_class_2.testClassSubFieldObject.testClassGrandChildString
	}
	render() {
		this.someClassFunction()
		this.someOtherClassFunction(this.props.class_tracked_variable)
		return (
		  <Fragment />
		);
	}
}
export function trackedInsideFunction() {
	//track_this_variable
	const tracked_variable = {
		testFieldsString: 'test_string',
		ifStatementTestBoolean: true,
		testFieldsSubObject: {
				testSubFieldNull: null,
				testSubFieldString: 'test_substring',
				testSubFieldNumber: 42,
				testSubFieldObject: {testGrandChildString: 'test_grandchild'}
		},
		testFieldsNumber: 123,
		unusedVariable: false,
		testClassSentObj: {
			testClassSubFieldString: 'class_test',
			testClassSubFieldBoolean: true,
			testClassSubFieldObject: {
				testClassGrandChildString: 'test_class_grandchild'
			}
		},
		unusedTestVar: 'unused',
		JSXChildrenTest: 'jsx',
		mappedVariable: [{testFieldMap1: 0, testFieldMap2: {subFieldMap2: ''}}],
	}
	const usage1 = {lol: tracked_variable.lolzz}
	const usage2 = usage1.lol.isThisWorking
	const usageMap1 = tracked_variable.mappedVariable.map(tracked => tracked.testFieldMap1)
	const usageMap2 = tracked_variable.mappedVariable.map(({testFieldMap2}) => testFieldMap2.subFieldMap2)

	outer_function1(tracked_variable)
	outerFunction2(tracked_variable)
	return (
		<GenericReactClassComponent class_tracked_variable={tracked_variable.test_class_sent_obj.lol_in_snake_case.second_try_snake_case}>{tracked_variable.JSXChildrenTest}</GenericReactClassComponent>
	)
}