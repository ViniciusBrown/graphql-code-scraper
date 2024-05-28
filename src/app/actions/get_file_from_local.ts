"use server"
import { glob, globSync, globStream, globStreamSync, Glob } from 'glob'
import { readFileSync, lstatSync, existsSync } from "fs"

export const readFileFromLocal = async (path: string): Promise<string | null> => {
		let file: string = ""
		if(existsSync(path) && lstatSync(path).isFile()){
			file = path
		} else if (globSync(path+".*")){
			file = globSync(path+".*")[0]
		}
		if(existsSync(file) && lstatSync(file).isFile()){
			const content = readFileSync(
				file,
				"utf8"
			);
			return content
		}
		
    return null
}

export const getFileFromLocal = (path: string) => {
    const fileReader = new FileReader();
    if (path) {
      fileReader.onload = (e) => {
        console.log(fileReader.result)
      }
      fileReader.readAsText(path);
      
    }
    return () => {
      if (fileReader && fileReader.readyState === 1) {
        fileReader.abort();
      }
    }
}