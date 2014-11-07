package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gopherjs/gopherjs/js"
)

func init() {
	if js.Global != nil {
		panic("oops")
	}
}

func main() {
	c := make([]string, 0)
	f, err := os.Open("data")
	if err != nil {
		panic(err)
	}
	if err := json.NewDecoder(f).Decode(&c); err != nil {
		panic(err)
	}

	populate(c)

	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		b := time.Now()
		fmt.Println(strings.Join(suggestion(scanner.Text()), "|"))
		fmt.Println(time.Since(b))
	}
	fmt.Println(scanner.Err())
}
