import { Completion, CompletionSection } from "@codemirror/autocomplete";

const COMPLETION_JINJA_FILTERS_TYPE = "function";
const COMPLETION_JINJA_FILTERS_SECTION: CompletionSection = { name: "Jinja Filters", rank: 0 };
export const COMPLETION_JINJA_ANSIBLE_FILTERS_TYPE = "function";
export const COMPLETION_JINJA_ANSIBLE_FILTERS_SECTION: CompletionSection = { name: "Ansible Filters", rank: 1 };
const COMPLETION_JINJA_CONTROL_TYPE = "text";
const COMPLETION_JINJA_CONTROL_SECTION = "Jinja Control Structures";
export const COMPLETION_JINJA_HOST_VARIABLES_TYPE = "variable";
export const COMPLETION_JINJA_HOST_VARIABLES_SECTION = "Host Variables";
export const COMPLETION_JINJA_CUSTOM_VARIABLES_TYPE = "constant";
export const COMPLETION_JINJA_CUSTOM_VARIABLES_SECTION = "Custom Variables";

/* JINJA CONTROL STRUCTURES - https://jinja.palletsprojects.com/en/3.0.x/templates/#list-of-control-structures */
export const jinjaControlCompletions: Completion[] = [
  { label: "set", boost: 2 },
  { label: "if", boost: 1 },
  { label: "endif", boost: 1 },
  { label: "for", boost: 1 },
  { label: "endfor", boost: 1 },
  { label: "macro", boost: 0 },
  { label: "endmacro", boost: 0 },
  { label: "call", boost: 0 },
  { label: "endcall", boost: 0 },
  { label: "filter", boost: 0 },
  { label: "endfilter", boost: 0 },
].flatMap((c) => { return { label: c.label, boost: c.boost, type: COMPLETION_JINJA_CONTROL_TYPE, section: COMPLETION_JINJA_CONTROL_SECTION }; });

/* JINJA FILTERS - https://jinja.palletsprojects.com/en/2.10.x/templates/#builtin-filters */
export const jinjaFiltersCompletions: Completion[] = [
  { label: "abs" },
  { label: "attr" },
  { label: "batch" },
  { label: "capitalize" },
  { label: "center" },
  { label: "default" },
  { label: "dictsort" },
  { label: "escape" },
  { label: "filesizeformat" },
  { label: "first" },
  { label: "float" },
  { label: "forceescape" },
  { label: "format" },
  { label: "groupby" },
  { label: "indent" },
  { label: "int" },
  { label: "join" },
  { label: "last" },
  { label: "length" },
  { label: "list" },
  { label: "lower" },
  { label: "map" },
  { label: "max" },
  { label: "min" },
  { label: "pprint" },
  { label: "random" },
  { label: "reject" },
  { label: "rejectattr" },
  { label: "replace" },
  { label: "reverse" },
  { label: "round" },
  { label: "safe" },
  { label: "select" },
  { label: "selectattr" },
  { label: "slice" },
  { label: "sort" },
  { label: "string" },
  { label: "striptags" },
  { label: "sum" },
  { label: "title" },
  { label: "tojson" },
  { label: "trim" },
  { label: "truncate" },
  { label: "unique" },
  { label: "upper" },
  { label: "urlencode" },
  { label: "urlize" },
  { label: "wordcount" },
  { label: "wordwrap" },
  { label: "xmlattr" },
].flatMap((c) => { return { label: c.label, boost: 2, type: COMPLETION_JINJA_FILTERS_TYPE, section: COMPLETION_JINJA_FILTERS_SECTION, info: jinjaFiltersTooltipParser }; });

/* eslint-disable @stylistic/quotes */
const jinjaFilterTooltips: Record<string, string> = {
  "abs": `<b>abs(x, /)</b><br/>Return the absolute value of the argument.`,
  "attr": `<b>attr(obj, name)</b><br/>Get an attribute of an object. <span class="code">foo|attr("bar")</span> works like <span class="code">foo.bar</span> just that always an attribute is returned and items are not looked up.`,
  "batch": `<b>batch(value, linecount, fill_with=None)</b><br/>A filter that batches items. It works pretty much like slice just the other way round. It returns a list of lists with the given number of items. If you provide a second parameter this is used to fill up missing items. See this example:
<pre class="code">
&lt;table&gt;
{%- for row in items|batch(3, &apos;&amp;nbsp;&apos;) %}
  &lt;tr&gt;
  {%- for column in row %}
  &lt;td&gt;{{ column }}&lt;/td&gt;
  {%- endfor %}
  &lt;/tr&gt;
{%- endfor %}
&lt;/table&gt;
</pre>`,
  "capitalize": `<b>capitalize(s)</b><br/>Capitalize a value. The first character will be uppercase, all others lowercase.`,
  "center": `<b>center(value, width=80)</b><br/>Centers the value in a field of a given width.`,
  "default": `<b>default(value, default_value=&apos;&apos;, boolean=False)</b><br/>If the value is undefined it will return the passed default value, otherwise the value of the variable:<pre class="code">{{ my_variable|default(&apos;my_variable is not defined&apos;) }}</pre>This will output the value of <span class="code">my_variable</span> if the variable was defined, otherwise <span class="code">&apos;my_variable is not defined&apos;</span>. If you want to use default with variables that evaluate to false you have to set the second parameter to true:<pre class="code">{{ &apos;&apos;|default(&apos;the string was empty&apos;, true) }}</pre>`,
  "dictsort": `<b>dictsort(value, case_sensitive=False, by=&apos;key&apos;, reverse=False)</b><br/>Sort a dict and yield (key, value) pairs. Because python dicts are unsorted you may want to use this function to order them by either key or value:
<pre class="code">
{% for item in mydict|dictsort %}
  sort the dict by key, case insensitive

{% for item in mydict|dictsort(reverse=true) %}
  sort the dict by key, case insensitive, reverse order

{% for item in mydict|dictsort(true) %}
  sort the dict by key, case sensitive

{% for item in mydict|dictsort(false, &apos;value&apos;) %}
  sort the dict by value, case insensitive
</pre>`,
  "escape": `<b>escape(s)</b><br/>Convert the characters &amp;, &lt;, &gt;, ‘, and ” in string s to HTML-safe sequences. Use this if you need to display text that might contain such characters in HTML. Marks return value as markup string.`,
  "filesizeformat": `<b>filesizeformat(value, binary=False)</b><br/>Format the value like a ‘human-readable’ file size (i.e. 13 kB, 4.1 MB, 102 Bytes, etc). Per default decimal prefixes are used (Mega, Giga, etc.), if the second parameter is set to True the binary prefixes are used (Mebi, Gibi).`,
  "first": `<b>first(seq)</b><br/>Return the first item of a sequence.`,
  "float": `<b>float(value, default=0.0)</b><br/>Convert the value into a floating point number. If the conversion doesn’t work it will return <span class="code">0.0</span>. You can override this default using the first parameter.`,
  "forceescape": `<b>forceescape(value)</b><br/>Enforce HTML escaping. This will probably double escape variables.`,
  "format": `<b>format(value, *args, **kwargs)</b><br/>Apply python string formatting on an object:
<pre class="code">
{{ &quot;%s - %s&quot;|format(&quot;Hello?&quot;, &quot;Foo!&quot;) }}
  -&gt; Hello? - Foo!
</pre>`,
  "groupby": `<b>groupby(value, attribute)</b><br/>Group a sequence of objects by a common attribute.<br/>If you for example have a list of dicts or objects that represent persons with gender, first_name and last_name attributes and you want to group all users by genders you can do something like the following snippet:
<pre class="code">
&lt;ul&gt;
{% for group in persons|groupby(&apos;gender&apos;) %}
  &lt;li&gt;{{ group.grouper }}&lt;ul&gt;
  {% for person in group.list %}
    &lt;li&gt;{{ person.first_name }} {{ person.last_name }}&lt;/li&gt;
  {% endfor %}&lt;/ul&gt;&lt;/li&gt;
{% endfor %}
&lt;/ul&gt;
</pre>
Additionally it’s possible to use tuple unpacking for the grouper and list:
<pre class="code">
&lt;ul&gt;
{% for grouper, list in persons|groupby(&apos;gender&apos;) %}
  ...
{% endfor %}
&lt;/ul&gt;
</pre>
As you can see the item we’re grouping by is stored in the grouper attribute and the list contains all the objects that have this grouper in common.`,
  "indent": `<b>indent(s, width=4, first=False, blank=False, indentfirst=None)</b><br/>Return a copy of the string with each line indented by 4 spaces. The first line and blank lines are not indented by default.<br/><b>Parameters</b><ul><li><b>width</b> – Number of spaces to indent by.</li><li><b>first</b> – Don’t skip indenting the first line.</li><li><b>blank</b> – Don’t skip indenting empty lines.</li></ul>Changed in version 2.10: Blank lines are not indented by default.<br/>Rename the indentfirst argument to first.`,
  "int": `<b>int(value, default=0, base=10)</b><br/>Convert the value into an integer. If the conversion doesn’t work it will return 0. You can override this default using the first parameter. You can also override the default base (10) in the second parameter, which handles input with prefixes such as 0b, 0o and 0x for bases 2, 8 and 16 respectively. The base is ignored for decimal numbers and non-string values.`,
  "join": `<b>join(value, d=&apos;&apos;, attribute=None)</b><br/>Return a string which is the concatenation of the strings in the sequence. The separator between elements is an empty string per default, you can define it with the optional parameter:
<pre class="code">
{{ [1, 2, 3]|join(&apos;|&apos;) }}
  -&gt; 1|2|3

{{ [1, 2, 3]|join }}
  -&gt; 123
</pre>
It is also possible to join certain attributes of an object:
<pre class="code">
{{ users|join(&apos;, &apos;, attribute=&apos;username&apos;) }}
</pre>`,
  "last": `<b>last(seq)</b><br/>Return the last item of a sequence.`,
  "length": `<b>length(obj, /)</b><br/>Return the number of items in a container.`,
  "list": `<b>list(value)</b><br/>Convert the value into a list. If it was a string the returned list will be a list of characters.`,
  "lower": `<b>lower(s)</b><br/>Convert a value to lowercase.`,
  "map": `<b>map(*args, **kwargs)</b><br/>Applies a filter on a sequence of objects or looks up an attribute. This is useful when dealing with lists of objects but you are really only interested in a certain value of it.<br/>The basic usage is mapping on an attribute. Imagine you have a list of users but you are only interested in a list of usernames:
<pre class="code">
Users on this page: {{ users|map(attribute=&apos;username&apos;)|join(&apos;, &apos;) }}
</pre>
Alternatively you can let it invoke a filter by passing the name of the filter and the arguments afterwards. A good example would be applying a text conversion filter on a sequence:
<pre class="code">
Users on this page: {{ titles|map(&apos;lower&apos;)|join(&apos;, &apos;) }}
</pre>`,
  "max": `<b>max(value, case_sensitive=False, attribute=None)</b><br/>Return the largest item from the sequence.
<pre class="code">
{{ [1, 2, 3]|max }}
  -&gt; 3
</pre>
<b>Parameters</b><ul><li><b>case_sensitive</b> – Treat upper and lower case strings as distinct.</li><li><b>attribute</b> – Get the object with the max value of this attribute.</li></ul>`,
  "min": `<b>min(value, case_sensitive=False, attribute=None)</b><br/>Return the smallest item from the sequence.
<pre class="code">
{{ [1, 2, 3]|min }}
  -&gt; 1
</pre>
<b>Parameters</b><ul><li><b>case_sensitive</b> – Treat upper and lower case strings as distinct.</li><li><b>attribute</b> – Get the object with the max value of this attribute.</li></ul>`,
  "pprint": `<b>pprint(value, verbose=False)</b><br/>Pretty print a variable. Useful for debugging.<br/>With Jinja 1.2 onwards you can pass it a parameter. If this parameter is truthy the output will be more verbose (this requires pretty)`,
  "random": `<b>random(seq)</b><br/>Return a random item from the sequence.`,
  "reject": `<b>reject(*args, **kwargs)</b><br/>Filters a sequence of objects by applying a test to each object, and rejecting the objects with the test succeeding.<br/>If no test is specified, each object will be evaluated as a boolean.<br/>Example usage:
<pre class="code">
{{ numbers|reject(&quot;odd&quot;) }}
</pre>`,
  "rejectattr": `<b>rejectattr(*args, **kwargs)</b><br/>Filters a sequence of objects by applying a test to the specified attribute of each object, and rejecting the objects with the test succeeding.<br/>If no test is specified, the attribute’s value will be evaluated as a boolean.
<pre class="code">
{{ users|rejectattr(&quot;is_active&quot;) }}
{{ users|rejectattr(&quot;email&quot;, &quot;none&quot;) }}
</pre>`,
  "replace": `<b>replace(s, old, new, count=None)</b><br/>Return a copy of the value with all occurrences of a substring replaced with a new one. The first argument is the substring that should be replaced, the second is the replacement string. If the optional third argument count is given, only the first count occurrences are replaced:
<pre class="code">
{{ &quot;Hello World&quot;|replace(&quot;Hello&quot;, &quot;Goodbye&quot;) }}
  -&gt; Goodbye World

{{ &quot;aaaaargh&quot;|replace(&quot;a&quot;, &quot;d&apos;oh, &quot;, 2) }}
  -&gt; d&apos;oh, d&apos;oh, aaargh
</pre>`,
  "reverse": `<b>reverse(value)</b><br/>Reverse the object or return an iterator that iterates over it the other way round.`,
  "round": `<b>round(value, precision=0, method=&apos;common&apos;)</b><br/>Round the number to a given precision. The first parameter specifies the precision (default is 0), the second the rounding method:<ul><li><span class="code">&apos;common&apos;</span> rounds either up or down</li><li><span class="code">&apos;ceil&apos;</span> always rounds up</li><li><span class="code">&apos;floor&apos;</span> always rounds down</li></ul>If you don’t specify a method &apos;common&apos; is used.
<pre class="code">
{{ 42.55|round }}
  -&gt; 43.0
{{ 42.55|round(1, &amp;apos;floor&amp;apos;) }}
  -&gt; 42.5
</pre>
Note that even if rounded to 0 precision, a float is returned. If you need a real integer, pipe it through int:
<pre class="code">
{{ 42.55|round|int }}
  -&gt; 43
</pre>`,
  "safe": `<b>safe(value)</b><br/>Mark the value as safe which means that in an environment with automatic escaping enabled this variable will not be escaped.`,
  "select": `<b>select(*args, **kwargs)</b><br/>Filters a sequence of objects by applying a test to each object, and only selecting the objects with the test succeeding.<br/>If no test is specified, each object will be evaluated as a boolean.<br/>Example usage:
<pre class="code">
{{ numbers|select(&quot;odd&quot;) }}
{{ numbers|select(&quot;odd&quot;) }}
{{ numbers|select(&quot;divisibleby&quot;, 3) }}
{{ numbers|select(&quot;lessthan&quot;, 42) }}
{{ strings|select(&quot;equalto&quot;, &quot;mystring&quot;) }}
</pre>`,
  "selectattr": `<b>selectattr(*args, **kwargs)</b><br/>Filters a sequence of objects by applying a test to the specified attribute of each object, and only selecting the objects with the test succeeding.<br/>If no test is specified, the attribute’s value will be evaluated as a boolean.<br/>Example usage:
<pre class="code">
{{ users|selectattr(&quot;is_active&quot;) }}
{{ users|selectattr(&quot;email&quot;, &quot;none&quot;) }}
</pre>`,
  "slice": `<b>slice(value, slices, fill_with=None)</b><br/>Slice an iterator and return a list of lists containing those items. Useful if you want to create a div containing three ul tags that represent columns:
<pre class="code">
&lt;div class=&quot;columwrapper&quot;&gt;
  {%- for column in items|slice(3) %}
  &lt;ul class=&quot;column-{{ loop.index }}&quot;&gt;
  {%- for item in column %}
    &lt;li&gt;{{ item }}&lt;/li&gt;
  {%- endfor %}
  &lt;/ul&gt;
  {%- endfor %}
&lt;/div&gt;
</pre>
If you pass it a second argument it’s used to fill missing values on the last iteration.`,
  "sort": `<b>sort(value, reverse=False, case_sensitive=False, attribute=None)</b><br/>Sort an iterable. Per default it sorts ascending, if you pass it true as first argument it will reverse the sorting.<br/>If the iterable is made of strings the third parameter can be used to control the case sensitiveness of the comparison which is disabled by default.
<pre class="code">
{% for item in iterable|sort %}
  ...
{% endfor %}
</pre>
It is also possible to sort by an attribute (for example to sort by the date of an object) by specifying the attribute parameter:
<pre class="code">
{% for item in iterable|sort(attribute=&apos;date&apos;) %}
  ...
{% endfor %}
</pre>`,
  "string": `<b>string(object)</b><br/>Make a string unicode if it isn’t already. That way a markup string is not converted back to unicode.`,
  "striptags": `<b>striptags(value)</b><br/>Strip SGML/XML tags and replace adjacent whitespace by one space.`,
  "sum": `<b>sum(iterable, attribute=None, start=0)</b><br/>Returns the sum of a sequence of numbers plus the value of parameter ‘start’ (which defaults to 0). When the sequence is empty it returns start.<br/>It is also possible to sum up only certain attributes:
<pre class="code">
Total: {{ items|sum(attribute=&apos;price&apos;) }}
</pre>`,
  "title": `<b>title(s)</b><br/>Return a titlecased version of the value. I.e. words will start with uppercase letters, all remaining characters are lowercase.`,
  "tojson": `<b>tojson(value, indent=None)</b><br/>Dumps a structure to JSON so that it’s safe to use in <span class="code">&lt;script&gt;</span> tags. It accepts the same arguments and returns a JSON string. Note that this is available in templates through the <span class="code">|tojson</span> filter which will also mark the result as safe. Due to how this function escapes certain characters this is safe even if used outside of <span class="code">&lt;script&gt;</span> tags.<br/>The following characters are escaped in strings:<ul><li><span class="code">&lt;</span></li><li><span class="code">&gt;</span></li><li><span class="code">&amp;</span></li><li><span class="code">&amp;</span></li></ul>This makes it safe to embed such strings in any place in HTML with the notable exception of double quoted attributes. In that case single quote your attributes or HTML escape it in addition.<br/>The indent parameter can be used to enable pretty printing. Set it to the number of spaces that the structures should be indented with.<br/>Note that this filter is for use in HTML contexts only.`,
  "trim": `<b>trim(value)</b><br/>Strip leading and trailing whitespace.`,
  "truncate": `<b>truncate(s, length=255, killwords=False, end=&apos;...&apos;, leeway=None)</b><br/>Return a truncated copy of the string. The length is specified with the first parameter which defaults to 255. If the second parameter is true the filter will cut the text at length. Otherwise it will discard the last word. If the text was in fact truncated it will append an ellipsis sign (<span class="code">"..."</span>). If you want a different ellipsis sign than <span class="code">"..."</span> you can specify it using the third parameter. Strings that only exceed the length by the tolerance margin given in the fourth parameter will not be truncated.
<pre class="code">
{{ &quot;foo bar baz qux&quot;|truncate(9) }}
  -&gt; &quot;foo...&quot;
{{ &quot;foo bar baz qux&quot;|truncate(9, True) }}
  -&gt; &quot;foo ba...&quot;
{{ &quot;foo bar baz qux&quot;|truncate(11) }}
  -&gt; &quot;foo bar baz qux&quot;
{{ &quot;foo bar baz qux&quot;|truncate(11, False, &apos;...&apos;, 0) }}
  -&gt; &quot;foo bar...&quot;
</pre>
The default leeway on newer Jinja2 versions is 5 and was 0 before but can be reconfigured globally.`,
  "unique": `<b>unique(value, case_sensitive=False, attribute=None)</b><br/>Returns a list of unique items from the the given iterable.
<pre class="code">
{{ [&apos;foo&apos;, &apos;bar&apos;, &apos;foobar&apos;, &apos;FooBar&apos;]|unique }}
  -&gt; [&apos;foo&apos;, &apos;bar&apos;, &apos;foobar&apos;]
</pre>
The unique items are yielded in the same order as their first occurrence in the iterable passed to the filter.<br/><b>Parameters</b><ul><li><b>case_sensitive</b> – Treat upper and lower case strings as distinct.</li><li><b>attribute</b> – Filter objects with unique values for this attribute.</li></ul>`,
  "upper": `<b>upper(s)</b><br/>Convert a value to uppercase.`,
  "urlencode": `<b>urlencode(value)</b><br/>Escape strings for use in URLs (uses UTF-8 encoding). It accepts both dictionaries and regular strings as well as pairwise iterables.`,
  "urlize": `<b>urlize(value, trim_url_limit=None, nofollow=False, target=None, rel=None)</b><br/>Converts URLs in plain text into clickable links.<br/>If you pass the filter an additional integer it will shorten the urls to that number. Also a third argument exists that makes the urls “nofollow”:
<pre class="code">
{{ mytext|urlize(40, true) }}
  links are shortened to 40 chars and defined with rel=&quot;nofollow&quot;
</pre>
If target is specified, the <span class="code">target</span> attribute will be added to the <span class="code">&lt;a&gt;</span> tag:
<pre class="code">
{{ mytext|urlize(40, target=&apos;_blank&apos;) }}
</pre>`,
  "wordcount": `<b>wordcount(s)</b><br/>Count the words in that string.`,
  "wordwrap": `<b>wordwrap(s, width=79, break_long_words=True, wrapstring=None)</b><br/>Return a copy of the string passed to the filter wrapped after 79 characters. You can override this default using the first parameter. If you set the second parameter to false Jinja will not split words apart if they are longer than width. By default, the newlines will be the default newlines for the environment, but this can be changed using the wrapstring keyword argument.`,
  "xmlattr": `<b>xmlattr(d, autospace=True)</b><br/>Create an SGML/XML attribute string based on the items in a dict. All values that are neither none nor undefined are automatically escaped:
<pre class="code">
&lt;ul{{ {&apos;class&apos;: &apos;my_list&apos;, &apos;missing&apos;: none,
  &apos;id&apos;: &apos;list-%d&apos;|format(variable)}|xmlattr }}&gt;
...
&lt;/ul&gt;
</pre>
Results in something like this:
<pre class="code">
&lt;ul class=&quot;my_list&quot; id=&quot;list-42&quot;&gt;
...
&lt;/ul&gt;
</pre>
As you can see it automatically prepends a space in front of the item if the filter returned something unless the second parameter is false.`,
};
/* eslint-enable @stylistic/quotes */

function jinjaFiltersTooltipParser(completion: Completion) {
  const p = new DOMParser();
  if (completion.label in jinjaFilterTooltips && jinjaFilterTooltips[completion.label].length > 0) {
    const doc = p.parseFromString(`<div class="wrapper">${jinjaFilterTooltips[completion.label]}</div>`, "text/html");
    return doc.getElementsByClassName("wrapper")[0];
  }
  return null; /* eslint-disable-line no-null/no-null */
}
