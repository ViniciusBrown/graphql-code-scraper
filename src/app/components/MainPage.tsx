"use client"
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea";
import React, {useEffect, useState} from "react";
import { readFileFromLocal } from "../actions/get_file_from_local";
import dataDependencyTracker from "../server/utils/data_dependency_tracker";


const codeFile = `function nestedFunctionTest(tracked_nested){
	// this function will receive the tracked_variable.testFieldsSubObject and access its variables directly
	const usage1 = tracked_nested.testSubFieldString
	const usage2 = tracked_nested.testSubFieldNumber
	const usage3 = tracked_nested.testSubFieldObject.testGrandChildString
}
function outerFunction2(tracked_two){
	// this function on top of normal accesses will call the nestedFunctionTest to
	// check if those variables are being tracked and references back.
	const usage1 = tracked_two.testFieldsString
	const usage2 = tracked_two.testFieldsSubObject.testSubFieldNull
	const usage3 = nestedFunctionTest(tracked_two.testFieldsSubObject)
	return null
}
function outerFunction1(tracked_one){
	const usage1 = tracked_one.testFieldsNumber + 1
	const usage2 = tracked_one.testFieldsString
	return null
}
function trackedInsideFunction() {
	//track_this_variable
	const tracked_variable = {
			testFieldInScopeChange: 'test_in_scope',
			testFieldsString: 'test_string',
			testFieldsSubObject: {
				testSubFieldNull: null,
				testSubFieldString: 'test_substring', 
				testSubFieldNumber: 42, 
				testSubFieldObject: {testGrandChildString: 'test_grandchild'}
			},
			testFieldsNumber: 123,
			unusedVariable: false,
	}
	outerFunction1(tracked_variable)
	outerFunction2(tracked_variable)
	const test_in_scope_name_change = tracked_variable.testFieldInScopeChange
}
`;
const codeFile2 = `
function nestedFunctionTest(tracked_nested){
	// this function will receive the tracked_variable.testFieldsSubObject and access its variables directly
	const usage1 = tracked_nested.testSubFieldString
	const usage2 = tracked_nested.testSubFieldNumber
	const usage3 = tracked_nested.testSubFieldObject.testGrandChildString
}
function outerFunction2(tracked_two){
	// this function on top of normal accesses will call the nestedFunctionTest to
	// check if those variables are being tracked and references back.
	const usage1 = tracked_two.testFieldsString
	const usage2 = tracked_two.testFieldsSubObject.testSubFieldNull
	const usage3 = nestedFunctionTest(tracked_two.testFieldsSubObject)
	return null
}
function outerFunction1(tracked_one){
	const usage1 = tracked_one.testFieldsNumber + 1
	const usage2 = tracked_one.testFieldsString
	return null
}
function GenericReactFunctionComponent(props){
	function someClassFunction(){
		const usage1 = props.class_tracked_variable
	  	const usage2 = someOtherNestedFunction(usage1)
	}
	function someOtherClassFunction(tracked_class_1) {
		const usage1 = tracked_class_1.testClassSubFieldBoolean
	}
	function someOtherNestedFunction(tracked_class_2) {
		const usage1 = tracked_class_2.testClassSubFieldObject.testClassGrandChildString
	}
	someClassFunction()
	someOtherClassFunction(props.class_tracked_variable)
	return (
		<Fragment />
	);
}
class GenericReactClassComponent extends Component<Props, State> {
	someClassFunction() {
	  const usage1 = this.props.class_tracked_variable
	  const usage2 = this.someOtherNestedFunction(usage1)
	}
	someOtherClassFunction(tracked_class_1) {
		const usage1 = tracked_class_1.testClassSubFieldBoolean
	}
	someOtherNestedFunction(tracked_class_2) {
		const usage1 = tracked_class_2.testClassSubFieldObject.testClassGrandChildString
	}
	render(): Node {
		this.someClassFunction()
		this.someOtherClassFunction(this.props.class_tracked_variable)
		return (
		  <Fragment />
		);
	}
}
function trackedInsideFunction() {
	//track_this_variable
	const tracked_variable = {
		testFieldsString: 'test_string',
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
		JSXChildrenTest: 'jsx'
	}
	outerFunction1(tracked_variable)
	outerFunction2(tracked_variable)
	return (
		<GenericReactClassComponent class_tracked_variable={tracked_variable.testClassSentObj}>{tracked_variable.JSXChildrenTest}</GenericReactClassComponent>
	)
}
`;
const codeFile3 = `
const nestedFunctionTest = (tracked_nested) => {
	// this function will receive the tracked_variable.testFieldsSubObject and access its variables directly
	const { testSubFieldString: usage1 } = tracked_nested
	const usage2 = tracked_nested.testSubFieldNumber
	const usage3 = tracked_nested.testSubFieldObject.testGrandChildString
}
function outerFunction2(tracked_two){
	// this function on top of normal accesses will call the nestedFunctionTest to
	// check if those variables are being tracked and references back.
	const usage1 = tracked_two.testFieldsString
	const usage2 = tracked_two.testFieldsSubObject.testSubFieldNull
	const usage3 = nestedFunctionTest(tracked_two.testFieldsSubObject)
	return null
}
function outerFunction1(tracked_one){
	const usage1 = tracked_one.testFieldsNumber + 1
	const usage2 = tracked_one.testFieldsString
	return null
}
function trackedInsideFunction() {
	//track_this_variable
	const tracked_variable = {
		testFieldsString: 'test_string',
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
		JSXChildrenTest: 'jsx'
	}
	const aff = {someVar: tracked_variable.unusedTestVar, otherVar: tracked_variable.testClassSentObj.testClassSubFieldObject}
	const lol = aff.otherVar.testClassGrandChildString
	outerFunction1(tracked_variable)
	outerFunction2(tracked_variable)
	return (
		<GenericReactClassComponent class_tracked_variable={tracked_variable.testClassSentObj}>{tracked_variable.JSXChildrenTest}</GenericReactClassComponent>
	)
}
`



const MainPage: React.FC = () => {
  const [mainFile, setMainFile] = useState<string>('')
  const [repoName, setRepoName] = useState<string>('')
  const [filePath, setFilePath] = useState<string>('')

  const [trackableVariables, setTrackableVariables] = useState<string[]>([])
  const [trackedVariable, setTrackedVariable] = useState<string>('')

  const [trackedVariables, setTrackedVariables] = useState([])

  // const processCode = (code: string) => axios.get(
  //   "/api/example", 
  //   {params: {'code': code}})
  //   .then(({data}) => {
	// 	console.log(data)
	// 	setTrackedVariables(data)
	// })

	// const getCode = async (repo: string, path: string) => axios.post(
	// 	"/api/example", 
	// 	{'path': path, 'repository': repo})
	// 	.then(({data}) => {
	// 		data && data.fileContent && typeof data.fileContent === 'string' && setMainFile(data.fileContent)
	// 		console.log(data)
	// 		console.log(getVariablesOnFile(data.fileContent, "lol.js"))
	// 	}
	// )

	
	const [folder, setFolder ] = useState('')
	const single_file = "/Users/vdemedeirosbrown/code/code_scrapper/code-scrapper/src/tests/single_file_test_1.tsx"
	const import_file = "/Users/vdemedeirosbrown/code/code_scrapper/code-scrapper/src/tests/import_file_test_1.tsx"
	const [file, setFile] = useState(import_file)
	const [code, setCode] = useState('')

	const processOnFrontEnd = async (code: string) => {
		const data = await dataDependencyTracker(code, file)
		console.log(data)
		setTrackedVariables(data)
	}

	useEffect(() => {
		console.log(file)
		readFileFromLocal(file).then(d => d && setCode(d))
	}, [file])
	/// /Users/vdemedeirosbrown/code/pinboard/webapp/app/www/BannerButton.js
  return (
	<div className="flex flex-col justify-center gap-y-3 w-full">
		<Label className="self-center">GraphQL Code Scrapper</Label>
		<div className="flex flex-col justify-center gap-y-2">
			<Input type="email" placeholder="Project Folder Path" className="" value={folder} onChange={e => setFolder(e.target.value)} />
			<Input type="email" placeholder="Scan File Path" value={file} onChange={e => {setFile(e.target.value)}} />

			<Tabs defaultValue="Code" className="">
				<TabsList>
					<TabsTrigger value="Code">Code</TabsTrigger>
					<TabsTrigger value="Fragments">Fragments</TabsTrigger>
				</TabsList>
				<TabsContent value="Code">
				<Textarea rows={19} id={'input-code'} placeholder={'Please insert the code you want to crawl'} value={code} onChange={e => {setCode(e.target.value)}} />
				</TabsContent>
				<TabsContent value="Fragments">
					<div>
						{trackedVariables?.map(({fragment, name}) => 
								<Textarea rows={19} key={name} value={fragment.mergedValue} readOnly />
						)}
					</div>
				</TabsContent>
			</Tabs>
			<Button onClick={() => processOnFrontEnd(code)} className="w-[120px] self-center">Submit</Button>
		</div>
		
	</div>
  );
};

export default MainPage;