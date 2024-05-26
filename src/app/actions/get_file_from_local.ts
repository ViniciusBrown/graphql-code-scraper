"use server"


export const readFileFromLocal = (path: string) => {
    const { readFileSync, lstatSync } = require("fs");
		try {
			if(lstatSync(path).isFile()){
				const file = readFileSync(
					path,
					"utf8"
				);
				console.log(file)
				return file
			}
		} catch (error) {
			console.log(error)
		}
    return 
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