package main

import "github.com/gopherjs/gopherjs/js"

func main() {
	js.Global.Set("suggest", map[string]interface{}{
		"populate": populate,
		"suggest":  suggestion,
	})
}
