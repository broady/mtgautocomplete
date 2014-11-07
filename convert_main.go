package main

import (
	"encoding/json"
	"os"
)

func main() {
	c := make(map[string]interface{})
	if err := json.NewDecoder(os.Stdin).Decode(&c); err != nil {
		panic(err)
	}

	cns := make([]string, 0)
	for cn, _ := range c {
		cns = append(cns, cn)
	}
	if err := json.NewEncoder(os.Stdout).Encode(cns); err != nil {
		panic(err)
	}
}
